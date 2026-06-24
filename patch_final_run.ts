import fs from "fs";
const text = fs.readFileSync("src/App.tsx", "utf-8");
const replacement = fs.readFileSync("final_replacement.txt", "utf-8");

const startMarker = "{/* Content Box (Unified Line-by-Line Edit & Preview Area) */}";
const endMarker = "</main>";

const firstStart = text.indexOf(startMarker);
const lastEnd = text.lastIndexOf(endMarker) + endMarker.length;

if (firstStart === -1 || lastEnd === -1 || lastEnd < firstStart) {
  console.log("Markers error");
  process.exit(1);
}

const before = text.substring(0, firstStart);
const after = text.substring(lastEnd);

fs.writeFileSync("src/App.tsx", before + replacement + "\n" + after);
console.log("Success");
