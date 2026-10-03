import Link from "next/link";
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Acrevia home">
      <svg
        width="29"
        height="32"
        viewBox="0 0 29 32"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 28 14.5 3 27 28M7 19h15M11 28l3.5-7 3.5 7"
          stroke="currentColor"
          strokeWidth="1.6"
        />
      </svg>
      <span>
        acrevia<span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
