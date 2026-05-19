import React from "react";
import bottleImg from "../assets/spinning-bottle.png";

function SpinningBottle({ visible, className = "mb-8" }) {
  if (!visible) return null;

  return (
    <div
      className={`bottle-container flex justify-center pointer-events-none ${className}`}
      role="status"
      aria-label="Searching for sauces"
    >
      <img
        src={bottleImg}
        alt=""
        className="w-24 h-24 object-contain drop-shadow-lg bottle-spin"
      />
    </div>
  );
}

export default SpinningBottle;
