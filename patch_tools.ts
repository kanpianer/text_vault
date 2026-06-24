import fs from "fs";
let text = fs.readFileSync("src/App.tsx", "utf-8");

const oldTools = \`[
                  { label: "H1", format: "h1" },
                  { label: "H2", format: "h2" },
                  { label: "H3", format: "h3" },
                  { label: "Quote", format: "blockquote" },
                  { label: "Code", format: "pre" }
                ]\`;

const newTools = \`[
                  { label: "H1", format: "h1" },
                  { label: "H2", format: "h2" },
                  { label: "H3", format: "h3" },
                  { label: "Task", format: "task" },
                  { label: "List", format: "list" },
                  { label: "Quote", format: "blockquote" },
                  { label: "Table", format: "table" },
                  { label: "Image", format: "image" },
                  { label: "Code", format: "pre" }
                ]\`;

text = text.replace(oldTools, newTools);
text = text.replace(oldTools, newTools); // Do it twice for mobile and pc

fs.writeFileSync("src/App.tsx", text);
console.log("Success");
