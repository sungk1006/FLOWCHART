import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, "..", "app", "page.tsx");
const newReturnPath = path.join(__dirname, "new-page-return.txt");

const lines = fs.readFileSync(pagePath, "utf8").split(/\r?\n/);
const newReturn = fs.readFileSync(newReturnPath, "utf8").replace(/\r\n/g, "\n").split("\n");

const pageLine = lines.findIndex((l) => l.startsWith("export default function Page"));
if (pageLine < 0) throw new Error("export default function Page not found");

let startIdx = -1;
for (let i = pageLine + 1; i < lines.length; i++) {
  if (lines[i] === "  return (") {
    startIdx = i;
    break;
  }
}
if (startIdx < 0) throw new Error("return ( not found inside Page");

let endIdx = -1;
for (let i = startIdx + 1; i < lines.length; i++) {
  if (lines[i] === "  );") {
    endIdx = i;
  }
}
if (endIdx < 0) throw new Error("closing ); not found after Page return");

const out = [...lines.slice(0, startIdx), ...newReturn, ...lines.slice(endIdx + 1)];
fs.writeFileSync(pagePath, out.join("\n"), "utf8");
console.log("Spliced Page return: lines", startIdx + 1, "to", endIdx + 1, "replaced with", newReturn.length, "lines");
