import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const t = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
const a = t.indexOf('                <div className="flex flex-col gap-4">');
const b = t.indexOf('                <aside className="space-y-4 2xl:sticky');
if (a < 0 || b < 0) throw new Error("markers not found");
fs.writeFileSync(path.join(root, "scripts", "flow-snippet.txt"), t.slice(a, b), "utf8");
console.log("wrote flow-snippet.txt", b - a);
