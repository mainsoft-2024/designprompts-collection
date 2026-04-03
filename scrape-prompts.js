const fs = require('fs');
const https = require('https');
const path = require('path');

const BUNDLE_URL = 'https://www.designprompts.dev/assets/index-FHds4wvP.js';
const OUTPUT_DIR = './prompts';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  console.log('Downloading main bundle...');
  const code = await fetch(BUNDLE_URL);
  console.log(`Bundle size: ${(code.length / 1024).toFixed(0)}KB`);

  // Find Z5 = STYLE_DEFINITIONS object (starts at ~449775)
  const z5Marker = code.indexOf('Z5={academia:{id:"academia"');
  if (z5Marker < 0) { console.error('Could not find STYLE_DEFINITIONS'); return; }

  // Find the end of Z5 object by counting braces
  let depth = 0, end = z5Marker;
  for (let i = z5Marker; i < code.length; i++) {
    if (code[i] === '{') depth++;
    if (code[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const block = code.substring(z5Marker + 3, end); // skip 'Z5='
  console.log(`STYLE_DEFINITIONS block: ${(block.length / 1024).toFixed(0)}KB`);

  // Split by top-level style keys
  // Each style is a property: styleid:{id:"...",name:"...",...}
  // We need to parse each one individually

  // Find all style IDs at the top level
  const styleIds = [...block.matchAll(/(?:^{|,)([a-z-]+):\{id:"\1"/g)].map(m => m[1]);
  
  // Alternative: just find all id:"X",name:"Y" and extract content between them
  const idMatches = [...block.matchAll(/id:"([a-z-]+)",name:"([^"]+)",mode:"([^"]+)",fontType:"([^"]*)",description:"([^"]*)"/g)];
  
  console.log(`Found ${idMatches.length} style definitions`);
  
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  
  const results = [];
  
  for (let i = 0; i < idMatches.length; i++) {
    const m = idMatches[i];
    const id = m[1], name = m[2], mode = m[3], fontType = m[4], description = m[5];
    
    // Find the content for this style
    // It's between this match and the next one
    const searchStart = m.index + m[0].length;
    const searchEnd = (i + 1 < idMatches.length) ? idMatches[i+1].index : block.length;
    const styleBlock = block.substring(searchStart, searchEnd);
    
    // Find content:' or content:"
    let content = null;
    for (const q of ["'", '"', '`']) {
      const marker = `content:${q}`;
      const idx = styleBlock.indexOf(marker);
      if (idx < 0) continue;
      
      const start = idx + marker.length;
      let e = start;
      while (e < styleBlock.length) {
        if (styleBlock[e] === '\\') { e += 2; continue; }
        if (styleBlock[e] === q) break;
        e++;
      }
      if (e > start + 50) {
        content = styleBlock.substring(start, e);
        break;
      }
    }
    
    if (!content) {
      console.log(`  ✗ ${name} (${id}) - no content found`);
      continue;
    }
    
    // Unescape
    content = content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\'/g, "'")
      .replace(/\\\"/g, '"')
      .replace(/\\\\/g, '\\');
    
    // Save
    const filename = `${id}.md`;
    const filepath = path.join(OUTPUT_DIR, filename);
    const header = `# ${name}\n\n> ${description}\n\n---\n\n`;
    fs.writeFileSync(filepath, header + content);
    results.push({ id, name, description, mode, fontType, file: filename, size: content.length });
    console.log(`  ✓ ${name} (${id}) - ${(content.length / 1024).toFixed(1)}KB`);
  }
  
  // Save index
  fs.writeFileSync(path.join(OUTPUT_DIR, '_index.json'), JSON.stringify(results, null, 2));
  console.log(`\n✅ Saved ${results.length} prompts to ${OUTPUT_DIR}/`);
}

main().catch(console.error);