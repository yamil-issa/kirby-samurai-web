export function loadChromaKeyedImage(
  src: string,
  key: [number, number, number],
  tolerance = 10
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const [kr, kg, kb] = key;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - kr) <= tolerance &&
          Math.abs(data[i + 1] - kg) <= tolerance &&
          Math.abs(data[i + 2] - kb) <= tolerance
        ) {
          data[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error(`Impossible de charger l'image: ${src}`));
    img.src = src;
  });
}
