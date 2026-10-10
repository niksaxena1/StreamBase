import light from "../assets/logo-light.png";
import dark from "../assets/logo-dark.png";
export function LogoMark() {
  return (
    <span className="logo">
      <img
        className="logo-light"
        src={light}
        width="32"
        height="32"
        alt="StreamBase"
      />
      <img
        className="logo-dark"
        src={dark}
        width="32"
        height="32"
        alt="StreamBase"
      />
    </span>
  );
}
