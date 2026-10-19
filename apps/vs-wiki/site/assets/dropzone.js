// Drag-and-drop for every file upload: any `<label class="schematic-dropzone">` wrapping an
// `<input type="file">` accepts a dropped file as if it had been picked with the browse dialog (the
// input's own `change` handler does the work, so pages never handle drops themselves). Clicking still
// opens the browser's file picker because the input lives inside the label.
for (const zone of document.querySelectorAll(".schematic-dropzone")) {
  const input = zone.querySelector('input[type="file"]');
  if (!input) continue;
  for (const type of ["dragenter", "dragover"]) {
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  }
  for (const type of ["dragleave", "drop"]) {
    zone.addEventListener(type, (e) => { e.preventDefault(); zone.classList.remove("dragover"); });
  }
  zone.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    input.files = e.dataTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
