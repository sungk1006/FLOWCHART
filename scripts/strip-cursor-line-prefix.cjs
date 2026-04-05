const fs = require("fs");

const inPath = process.argv[2];
const outPath = process.argv[3];
if (!inPath || !outPath) {
  console.error("Usage: node strip-cursor-line-prefix.cjs <in> <out>");
  process.exit(1);
}
const raw = fs.readFileSync(inPath, "utf8");
const out = raw
  .split(/\r?\n/)
  .map((line) => {
    const m = line.match(/^\s*\d+\|(.*)$/);
    return m ? m[1] : line;
  })
  .join("\n");
fs.writeFileSync(outPath, out, "utf8");
