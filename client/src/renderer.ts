export type SceneState = "connecting" | "presentation" | "wait" | "signal" | "foul" | "result";

// Translucent tint drawn over the background per state — null means no tint.
const TINT: Record<SceneState, string | null> = {
  connecting: null,
  presentation: null,
  wait: null,
  signal: "rgba(192, 57, 43, 0.45)",
  foul: "rgba(122, 31, 31, 0.55)",
  result: null,
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Impossible de charger l'image: ${src}`));
    img.src = src;
  });
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLImageElement | null = null;
  private bannerTop: HTMLImageElement | null = null;
  private bannerBottom: HTMLImageElement | null = null;
  bgReady: Promise<void>;

  constructor(
    private canvas: HTMLCanvasElement,
    bgSrc: string,
    bannerTopSrc?: string,
    bannerBottomSrc?: string
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false; // keep pixel art crisp when scaled up

    const loads: Promise<void>[] = [
      loadImage(bgSrc).then((img) => {
        this.bg = img;
      }),
    ];
    if (bannerTopSrc) {
      loads.push(loadImage(bannerTopSrc).then((img) => (this.bannerTop = img)));
    }
    if (bannerBottomSrc) {
      loads.push(loadImage(bannerBottomSrc).then((img) => (this.bannerBottom = img)));
    }
    this.bgReady = Promise.all(loads).then(() => undefined);
  }

  // Scales the background to fill the whole canvas without distorting it,
  // cropping whatever overflows — same idea as CSS `background-size: cover`.
  private drawBackgroundCover() {
    if (!this.bg) return;
    const { ctx, canvas, bg } = this;
    const scale = Math.max(canvas.width / bg.width, canvas.height / bg.height);
    const drawW = bg.width * scale;
    const drawH = bg.height * scale;
    const dx = (canvas.width - drawW) / 2;
    const dy = (canvas.height - drawH) / 2;
    ctx.drawImage(bg, dx, dy, drawW, drawH);
  }

  // Stretches a banner to the full canvas width, pinned to the top or bottom
  // edge, preserving its aspect ratio (so it stays a thin horizontal strip).
  private drawBanner(img: HTMLImageElement, edge: "top" | "bottom") {
    const { ctx, canvas } = this;
    const scale = canvas.width / img.width;
    const drawH = img.height * scale;
    const dy = edge === "top" ? 0 : canvas.height - drawH;
    ctx.drawImage(img, 0, dy, canvas.width, drawH);
  }

  draw(state: SceneState, message: string) {
    const { ctx, canvas } = this;

    if (this.bg) {
      this.drawBackgroundCover();
    } else {
      ctx.fillStyle = "#111318"; // fallback while the image is still loading
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const tint = TINT[state];
    if (tint) {
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (state === "presentation") {
      if (this.bannerTop) this.drawBanner(this.bannerTop, "top");
      if (this.bannerBottom) this.drawBanner(this.bannerBottom, "bottom");
    }

    ctx.fillStyle = "#fff";
    ctx.font = "bold 36px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 6;
    ctx.fillText(message, canvas.width / 2, canvas.height / 2);
    ctx.shadowBlur = 0;
  }
}
