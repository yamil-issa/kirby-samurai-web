import { GameConnection } from "./network";
import { Renderer } from "./renderer";
import bgUrl from "./assets/background/game-bg.png";
import banner1Url from "./assets/background/character1-pres.png";
import banner2Url from "./assets/background/character2-pres.png";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const status = document.getElementById("status")!;
const renderer = new Renderer(canvas, bgUrl, banner1Url, banner2Url);

let canAct = false;

renderer.bgReady
  .then(() => renderer.draw("connecting", "Connexion..."))
  .catch((err) => console.error(err));

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
      break;
    case "signal":
      status.textContent = "MAINTENANT !";
      renderer.draw("signal", "SHOOT!");
      break;
    case "foul":
      canAct = false;
      status.textContent = "Faute ! Trop tot, la manche recommence.";
      renderer.draw("foul", "FAUTE !");
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
  conn.sendAction();
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") act();
});
canvas.addEventListener("click", act);
