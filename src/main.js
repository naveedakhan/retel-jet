import "./styles.css";
import { startGame } from "./game.js";

startGame().catch((error) => {
  console.error("Failed to start game.", error);
});
