import { GameConnection } from "./network";
import { Renderer } from "./renderer";
import { AudioManager } from "./audio";
import bgUrl from "./assets/background/game-bg.png";
import banner1Url from "./assets/background/character1-pres.png";
import banner2Url from "./assets/background/character2-pres.png";
import char1Url from "./assets/characters/character1-idle.png";
import char2Url from "./assets/characters/character2-idle.png";
import shootIconUrl from "./assets/effects/shoot.png";
import musicUrl from "./assets/sounds/samurai-kirby.wav";
import thudUrl from "./assets/sounds/thud.wav";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const status = document.getElementById("status")!;
const renderer = new Renderer(canvas, bgUrl, banner1Url, banner2Url, char1Url, char2Url, shootIconUrl);
const audio = new AudioManager(musicUrl, thudUrl);

let canAct = false;

// Wait for every asset to be loaded before doing anything else. Otherwise a
// player who joins an already-waiting room gets matched almost instantly,
// and the presentation banners can arrive before their images are ready —
// silently skipping the banner draw.
renderer.bgReady
  .then(() => {
    renderer.draw("connecting", "Clique ou appuie sur Espace pour commencer");
    waitForStartGesture();
  })
  .catch((err) => console.error(err));

// Browsers block audio.play() until the page has received a real user
// gesture. This screen doubles as that gesture (needed before the music can
// autoplay the instant the match starts) and as a normal "ready?" prompt.
function waitForStartGesture() {
  const start = () => {
    window.removeEventListener("keydown", start);
    canvas.removeEventListener("click", start);
    renderer.draw("connecting", "Connexion...");
    connectToServer();
  };
  window.addEventListener("keydown", start, { once: true });
  canvas.addEventListener("click", start, { once: true });
}

function connectToServer() {
  const conn = new GameConnection("ws://localhost:3001", (event) => {
    switch (event.type) {
      case "matched":
        status.textContent = "Adversaire trouve !";
        renderer.draw("presentation", "");
        break;
      case "wait":
        canAct = true;
        status.textContent = "Attends le signal...";
        renderer.draw("wait", "Matte...");
        audio.playMusic();
        break;
      case "signal":
        status.textContent = "MAINTENANT !";
        renderer.draw("signal", "SHOOT!");
        audio.stopMusic();
        audio.playThud();
        break;
      case "foul":
        canAct = false;
        status.textContent = "Faute ! Trop tot, la manche recommence.";
        renderer.draw("foul", "FAUTE !");
        audio.stopMusic();
        break;
      case "result": {
        canAct = false;
        const label =
          event.winner === 0
            ? `Gagne ! (${event.yourReactionMs.toFixed(0)} ms)`
            : event.winner === 1
              ? `Perdu... (adversaire: ${event.opponentReactionMs.toFixed(0)} ms)`
              : "Egalite !";
        status.textContent = label;
        renderer.draw("result", label);
        break;
      }
    }
  });

  function act() {
    if (!canAct) return;
    canAct = false;
    renderer.draw("acted", ""); // instant feedback: hide the icon right away, don't wait for the server
    conn.sendAction();
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") act();
  });
  canvas.addEventListener("click", act);
}
