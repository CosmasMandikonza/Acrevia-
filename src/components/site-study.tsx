// An original schematic illustration, not a parcel or computed scenario.
export function SiteStudy() {
  return (
    <figure className="site-study">
      <div className="study-heading">
        <span>LAND / MISSION / POSSIBILITY</span>
        <span>CONCEPT STUDY — 01</span>
      </div>
      <svg
        viewBox="0 0 720 540"
        role="img"
        aria-labelledby="study-title study-desc"
      >
        <title id="study-title">
          A conceptual church site and space for future possibilities
        </title>
        <desc id="study-desc">
          An architectural line drawing shows an existing sanctuary, trees and a
          dashed outline for potential development. It is illustrative, not a
          real property analysis.
        </desc>
        <defs>
          <pattern
            id="study-grid"
            width="36"
            height="36"
            patternUnits="userSpaceOnUse"
          >
            <path d="M36 0H0V36" className="study-grid-line" fill="none" />
          </pattern>
          <pattern
            id="study-hatch"
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(30)"
          >
            <path d="M0 0V9" className="study-hatch-line" />
          </pattern>
        </defs>
        <rect width="720" height="540" fill="url(#study-grid)" />
        <g
          className="study-site"
          transform="translate(350 255) scale(1 .57) rotate(-30)"
        >
          <path d="M-255-180H225V185H-255Z" className="study-ground" />
          <path d="M-278-205H250V210H-278Z" className="study-parcel" />
          <path d="M-255 143H225M-205-180V185" className="study-path" />
          <path d="M-140-125H50V25H-140Z" className="study-green" />
          <path
            d="M75-120H192V111H75Z"
            fill="url(#study-hatch)"
            className="study-possible"
          />
          <path
            d="M75-120V-215H192V-120M192-215V16L75 111V-120M75-215V16H192"
            className="study-envelope"
          />
          <path
            d="M-123-117V-187L-42-229 39-187V-117Z"
            className="study-building-front"
          />
          <path d="M39-187V-47L-42-5V-145Z" className="study-building-side" />
          <path d="M-123-187-42-229 39-187-42-145Z" className="study-roof" />
          <path
            d="M-123-187V-47L-42-5V-145Z"
            className="study-building-front"
          />
          <path
            d="M-86-101V-65M-66-91V-55M-106-111V-75"
            className="study-window"
          />
          <path
            d="M-55-184V-263L-36-279-17-263V-184Z"
            className="study-building-front"
          />
          <path d="M-36-279V-306M-46-295H-26" className="study-spire" />
          {[-160, -110, -60, -10, 40, 90, 140].map((x) => (
            <path key={x} d={`M${x} 165v19`} className="study-parking" />
          ))}
          {[
            [-230, -135],
            [-230, -60],
            [-175, 80],
            [30, 85],
            [220, -145],
            [220, -50],
            [220, 55],
          ].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="22" className="study-tree" />
              <circle
                cx={x - 5}
                cy={y - 5}
                r="16"
                className="study-tree-inner"
              />
            </g>
          ))}
        </g>
        <path
          d="M229 296 126 351H58M492 231 558 173H666"
          className="study-leader"
        />
        <text x="58" y="374" className="study-label">
          PRESERVE WHAT MATTERS
        </text>
        <text x="538" y="156" className="study-label">
          EXPLORE WHAT’S POSSIBLE
        </text>
        <path d="M632 445v-44l-6 12m6-12 6 12" className="study-leader" />
        <text x="628" y="465" className="study-label">
          N
        </text>
      </svg>
      <figcaption>
        <span>
          <i className="legend-line" />
          Existing ministry
        </span>
        <span>
          <i className="legend-line dashed" />
          Possible development
        </span>
        <span className="study-disclaimer">
          Illustration only · not a feasibility result
        </span>
      </figcaption>
    </figure>
  );
}
