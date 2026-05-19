import React from "react";
import bottleImg from "../assets/spinning-bottle.png";

function SpinningBottle({ spinning }) {
  return (
    <div
      className="bottle-container flex justify-center mb-8 pointer-events-none"
      aria-hidden={!spinning}
    >
      <img
        src={bottleImg}
        alt=""
        className={`w-24 h-24 object-contain drop-shadow-lg ${spinning ? "bottle-spin" : ""}`}
      />
    </div>
  );
}

export default SpinningBottle;
