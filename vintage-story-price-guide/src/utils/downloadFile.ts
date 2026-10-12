
/**
 * 
 * @see https://stackoverflow.com/questions/50694881/how-to-download-file-in-react-js
 * 
 * @param file 
 */
export function downloadFile(file: File) {
      const url = window.URL.createObjectURL(file);

      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
          'download',
          file.name,
      );

      // Append to html link element page
      document.body.appendChild(link);

      // Start download
      link.click();

      // Clean up and remove the link
      link.parentNode?.removeChild(link);
}