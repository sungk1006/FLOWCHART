import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const t = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
const a = t.indexOf('                <aside className="space-y-4 2xl:sticky');
const b = t.indexOf("                </aside>", a);
if (a < 0 || b < 0) throw new Error("markers not found");
const end = b + "                </aside>".length;
let inner = t.slice(a, end);
inner = inner.replace(
  '<aside className="space-y-4 2xl:sticky 2xl:top-4 2xl:self-start">',
  '<section className="space-y-4">'
);
inner = inner.replace("</aside>", "</section>");
fs.writeFileSync(path.join(root, "scripts", "email-snippet.txt"), inner, "utf8");
console.log("wrote email-snippet.txt", inner.length);
