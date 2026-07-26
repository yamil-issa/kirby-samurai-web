import { GameConnection } from "./network";
import { Renderer, type DuelOutcome } from "./renderer";
import { AudioManager } from "./audio";
import bgUrl from "./assets/background/game-bg.png";
import banner1Url from "./assets/background/character1-pres.png";
import banner2Url from "./assets/background/character2-pres.png";
import char1IdleUrl from "./assets/characters/character1-idle.png";
import char2IdleUrl from "./assets/characters/character2-idle.png";
import char1WinUrl from "./assets/characters/character1-win.png";
import char1LooseUrl from "./assets/characters/character1-lose.png";
import char2WinUrl from "./assets/characters/character2-win.png";
import char2LooseUrl from "./assets/characters/character2-lose.png";
import shootIconUrl from "./assets/effects/shoot.png";
import musicUrl from "./assets/sounds/samurai-kirby.wav";
import thudUrl from "./assets/sounds/thud.wav";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const status = document.getElementById("status")!;
const renderer = new Renderer(canvas, {
  background: bgUrl,
  bannerTop: banner1Url,
  bannerBottom: banner2Url,
  characterLeft: { idle: char1IdleUrl, win: char1WinUrl, loose: char1LooseUrl },
  characterRight: { idle: char2IdleUrl, win: char2WinUrl, loose: char2LooseUrl },
  shootIcon: shootIconUrl,
});
const audio = new AudioManager(musicUrl, thudUrl);

let canAct = false;
let mySlot: 0 | 1 = 0; // 0 = character1 (left), 1 = character2 (right)

// Wait for every asset to be loaded before doing anything else.
renderer.bgReady
  .then(() => {
    renderer.draw("connecting", "Clique ou appuie sur Espace pour commencer");
    waitForStartGesture();
  })
  .catch((err) => console.error(err));

// Browsers block audio.play() until the page has received a real user
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
        mySlot = event.slot;
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

        // Determine the outcome from the perspective of this client.
        let outcome: DuelOutcome;
        if (event.winner === 2) {
          outcome = "draw";
        } else {
          const iWon = event.winner === 0;
          const iAmCharacter1 = mySlot === 0;
          outcome = iWon === iAmCharacter1 ? "character1" : "character2";
        }

        renderer.draw("result", label, outcome);
        break;
      }
    }
  });

  function act() {
    if (!canAct) return;
    canAct = false;
    renderer.draw("acted", "");
    conn.sendAction();
  }

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") act();
  });
  canvas.addEventListener("click", act);
}
