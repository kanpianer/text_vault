import fs from "fs";
const text = fs.readFileSync("src/App.tsx", "utf-8");
const replacement = fs.readFileSync("replacement.txt", "utf-8");
const startMarker = "{/* Content Box (Unified Line-by-Line Edit & Preview Area) */}";
const endMarker = "{/* Mobile bottom-sticky adaptive toolbar */}";
const startIndex = text.indexOf(startMarker);
const endIndex = text.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.log("Markers not found");
  process.exit(1);
}

const before = text.substring(0, startIndex);
const after = text.substring(endIndex);

fs.writeFileSync("src/App.tsx", before + replacement + after);
console.log("Success");
