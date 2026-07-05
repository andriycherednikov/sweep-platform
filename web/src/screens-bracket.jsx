/* ============================================================
   THE SWEEP — knockout bracket: KnockoutsScreen + BracketView + R32_DEFS
   (moved verbatim from screens-main.jsx — cup/knockout formats only)
   ============================================================ */
import { useEffect, useRef } from "react";
import { SWEEP as S } from "./data.js";
import {
  Icon, Flag, AvStack, AppHeader, useIsDesktop, useScrolled, ScoreCover, PenScore,
} from "./components.jsx";
import { useSocial, getMe } from "./social.js";
import { liveLabel } from "./lib/format.js";
import { useSpoiler, spoilerHidden } from "./spoiler.js";
import { celebrate } from "./lib/celebrate.js";

/* ---------------- BRACKET VISUALIZER ---------------- */
const R32_DEFS = [
  { id: "1", side: "left", t1: "de", t2: "py", venue: "Boston · June 29" },
  { id: "2", side: "left", t1: "fr", t2: "se", venue: "New York · June 30" },
  { id: "3", side: "left", t1: "za", t2: "ca", venue: "Los Angeles · June 28" },
  { id: "4", side: "left", t1: "nl", t2: "ma", venue: "Monterrey · June 29" },
  { id: "5", side: "left", t1: "pt", t2: "hr", venue: "Toronto · July 2" },
  { id: "6", side: "left", t1: "es", t2: "at", venue: "Los Angeles · July 2" },
  { id: "7", side: "left", t1: "us", t2: "bih", venue: "San Francisco · July 1" },
  { id: "8", side: "left", t1: "be", t2: "sn", venue: "Seattle · July 1" },

  { id: "9", side: "right", t1: "br", t2: "jp", venue: "Houston · June 29" },
  { id: "10", side: "right", t1: "ci", t2: "no", venue: "Dallas · June 30" },
  { id: "11", side: "right", t1: "mx", t2: "ec", venue: "Mexico City · June 30" },
  { id: "12", side: "right", t1: "gb-eng", t2: "cgo", venue: "Atlanta · July 1" },
  { id: "13", side: "right", t1: "ar", t2: "cpv", venue: "Miami · July 3" },
  { id: "14", side: "right", t1: "au", t2: "eg", venue: "Dallas · July 3" },
  { id: "15", side: "right", t1: "ch", t2: "dz", venue: "Vancouver · July 2" },
  { id: "16", side: "right", t1: "co", t2: "gh", venue: "Kansas City · July 3" },
];

function BracketMatchBox({ fixture, team1Code, team2Code, venueDate, onOpen, openTeam }) {
  useSpoiler();
  const f = fixture || (team1Code && team2Code && team1Code !== "__DECIDED__" && team2Code !== "__DECIDED__" ? S.fixtures.find(x => (x.t1 === team1Code && x.t2 === team2Code) || (x.t1 === team2Code && x.t2 === team1Code)) : null);
  
  const codeA = f ? f.t1 : team1Code;
  const codeB = f ? f.t2 : team2Code;
  const isDecidedA = codeA === "__DECIDED__";
  const isDecidedB = codeB === "__DECIDED__";

  const teamA = (codeA && !isDecidedA) ? S.team(codeA) : null;
  const teamB = (codeB && !isDecidedB) ? S.team(codeB) : null;
  
  const oA = (codeA && !isDecidedA) ? S.ownersOf(codeA) : [];
  const oB = (codeB && !isDecidedB) ? S.ownersOf(codeB) : [];
  
  const scoreA = f?.score ? f.score[0] : null;
  const scoreB = f?.score ? f.score[1] : null;
  const isLive = f?.status === "live";
  const isFinal = f?.status === "final";
  const showScores = f && (isFinal || isLive) && f.score != null;
  const isHidden = f && spoilerHidden(f) && showScores;

  const winCode = (isFinal && !isHidden) ? (f?.winnerCode && f.winnerCode !== 'DRAW' ? f.winnerCode : (scoreA != null && scoreB != null ? (scoreA > scoreB ? codeA : scoreB > scoreA ? codeB : null) : null)) : null;
  const winnerA = (isFinal && !isHidden) && winCode === codeA;
  const winnerB = (isFinal && !isHidden) && winCode === codeB;
  const elimA = (codeA && !isDecidedA && !isHidden) ? S.isTeamEliminated(codeA) : false;
  const elimB = (codeB && !isDecidedB && !isHidden) ? S.isTeamEliminated(codeB) : false;
  const loserA = !isHidden && ((isFinal && scoreA != null && !winnerA) || elimA);
  const loserB = !isHidden && ((isFinal && scoreB != null && !winnerB) || elimB);

  const me = getMe();
  const myTeams = me ? me.teams : [];
  const isMineA = codeA && !isDecidedA && myTeams.indexOf(codeA) >= 0;
  const isMineB = codeB && !isDecidedB && myTeams.indexOf(codeB) >= 0;
  const isMine = isMineA || isMineB;

  const parts = (venueDate || "").split("·").map(s => s.trim());
  const defaultCity = parts[0] || "TBD";
  const defaultDate = parts[1] || "";
  const dateStr = f ? `${f.dayLabel}${f.timeLabel ? ' · ' + f.timeLabel : ''}` : defaultDate;
  const stadiumStr = f ? (f.venue ? (f.city && !f.venue.toLowerCase().includes(f.city.toLowerCase()) ? `${f.venue} · ${f.city}` : f.venue) : f.city) : defaultCity;

  return (
    <div className={"b-match-box" + (isMine ? " mine" : "")} onClick={() => f && onOpen && onOpen(f)} style={{ cursor: f ? "pointer" : "default" }}>
      <div className="b-match-head">
        <div className="b-head-row">
          {/* once live, the whole date line is redundant — the live dot carries the status */}
          {!isLive && <span className="b-head-date">{dateStr || "TBD"}</span>}
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {isLive && <span className="b-live-dot">● {[liveLabel(f), "LIVE"].filter(Boolean).join(" ")}</span>}
            {isFinal && <span className="b-ft-tag">FT</span>}
            {showScores && isHidden && (
              <div onClick={(e) => e.stopPropagation()} style={{display:"inline-flex", scale:"0.85", transformOrigin:"right center"}}>
                <ScoreCover f={f} />
              </div>
            )}
          </div>
        </div>
        <div className="b-head-row">
          <span className="b-head-stadium">
            <Icon.pin style={{width:10.5,height:10.5,stroke:"var(--muted2)",flexShrink:0}}/>
            <span>{stadiumStr}</span>
          </span>
          {isMine && <span className="mine-tag" style={{fontSize:8.5,padding:"1.5px 5px",borderRadius:4,flexShrink:0}}><Icon.star/> Your team</span>}
        </div>
      </div>
      <div className={"b-team-row" + (winnerA ? " winner" : loserA ? " loser" : "")}>
        <div className="b-team-info" onClick={(e) => { if (codeA && !isDecidedA && openTeam) { e.stopPropagation(); openTeam(codeA); } }}>
          {isDecidedA ? (
            <>
              <div className="b-flag-ph" />
              <div className="b-team-name-ph" title="Winner decided (hidden by privacy mode)" />
            </>
          ) : codeA ? (
            <>
              <Flag code={codeA} w={20} h={14} />
              <span className="b-team-name">{teamA ? teamA.name : codeA}</span>
            </>
          ) : (
            <>
              <div className="b-flag-ph" />
              <span className="b-team-name">TBD</span>
            </>
          )}
        </div>
        {!isDecidedA && oA.length > 0 && <AvStack people={oA} size={24} max={3} />}
        {showScores && !isHidden && (
          <span className="b-score" style={{ display: "inline-flex", alignItems: "baseline" }}>
            <span>{scoreA}</span>
            <PenScore pen={f?.penScore} side={0} />
          </span>
        )}
      </div>
      <div className={"b-team-row" + (winnerB ? " winner" : loserB ? " loser" : "")}>
        <div className="b-team-info" onClick={(e) => { if (codeB && !isDecidedB && openTeam) { e.stopPropagation(); openTeam(codeB); } }}>
          {isDecidedB ? (
            <>
              <div className="b-flag-ph" />
              <div className="b-team-name-ph" title="Winner decided (hidden by privacy mode)" />
            </>
          ) : codeB ? (
            <>
              <Flag code={codeB} w={20} h={14} />
              <span className="b-team-name">{teamB ? teamB.name : codeB}</span>
            </>
          ) : (
            <>
              <div className="b-flag-ph" />
              <span className="b-team-name">TBD</span>
            </>
          )}
        </div>
        {!isDecidedB && oB.length > 0 && <AvStack people={oB} size={24} max={3} />}
        {showScores && !isHidden && (
          <span className="b-score" style={{ display: "inline-flex", alignItems: "baseline" }}>
            <span>{scoreB}</span>
            <PenScore pen={f?.penScore} side={1} />
          </span>
        )}
      </div>
    </div>
  );
}

function BracketView({ onOpen, openTeam }) {
  useSpoiler();
  const isDesktop = useIsDesktop();
  const headerRef = useRef(null);
  const onHScroll = (e) => {
    if (headerRef.current) headerRef.current.scrollLeft = e.target.scrollLeft;
  };

  const getWinner = (def) => {
    if (!def) return null;
    if (!def.t1 || !def.t2 || def.t1 === "__DECIDED__" || def.t2 === "__DECIDED__") return null;
    const f = S.fixtures.find(x => (x.t1 === def.t1 && x.t2 === def.t2) || (x.t1 === def.t2 && x.t2 === def.t1));
    if (!f || f.status !== "final") return null;
    if (spoilerHidden(f)) return "__DECIDED__";
    if (f.winnerCode && f.winnerCode !== 'DRAW') return f.winnerCode;
    if (!f.score) return null;
    return f.score[0] > f.score[1] ? f.t1 : f.score[1] > f.score[0] ? f.t2 : null;
  };

  const leftR32 = R32_DEFS.filter(d => d.side === "left");
  const rightR32 = R32_DEFS.filter(d => d.side === "right");

  const r16Left = [
    { venue: "Philadelphia · July 4", t1: getWinner(leftR32[0]), t2: getWinner(leftR32[1]) },
    { venue: "Houston · July 4", t1: getWinner(leftR32[2]), t2: getWinner(leftR32[3]) },
    { venue: "Dallas · July 6", t1: getWinner(leftR32[4]), t2: getWinner(leftR32[5]) },
    { venue: "Los Angeles · July 6", t1: getWinner(leftR32[6]), t2: getWinner(leftR32[7]) },
  ];

  const r16Right = [
    { venue: "New York · July 5", t1: getWinner(rightR32[0]), t2: getWinner(rightR32[1]) },
    { venue: "Mexico City · July 5", t1: getWinner(rightR32[2]), t2: getWinner(rightR32[3]) },
    { venue: "Atlanta · July 7", t1: getWinner(rightR32[4]), t2: getWinner(rightR32[5]) },
    { venue: "Vancouver · July 7", t1: getWinner(rightR32[6]), t2: getWinner(rightR32[7]) },
  ];

  const qfLeft = [
    { venue: "Boston · July 9", t1: getWinner(r16Left[0]), t2: getWinner(r16Left[1]) },
    { venue: "Los Angeles · July 10", t1: getWinner(r16Left[2]), t2: getWinner(r16Left[3]) },
  ];
  const qfRight = [
    { venue: "Miami · July 11", t1: getWinner(r16Right[0]), t2: getWinner(r16Right[1]) },
    { venue: "Kansas City · July 11", t1: getWinner(r16Right[2]), t2: getWinner(r16Right[3]) },
  ];

  const sfLeft = [{ venue: "Dallas · July 14", t1: getWinner(qfLeft[0]), t2: getWinner(qfLeft[1]) }];
  const sfRight = [{ venue: "Atlanta · July 15", t1: getWinner(qfRight[0]), t2: getWinner(qfRight[1]) }];

  const finalMatch = { venue: "MetLife Stadium · July 19", t1: getWinner(sfLeft[0]), t2: getWinner(sfRight[0]) };

  // Confetti when the Final is decided (real winner, not spoiler-hidden). Fires
  // once per mount — mirrors the Placement crown in screens-detail.jsx.
  const champion = getWinner(finalMatch);
  const celebratedRef = useRef(false);
  useEffect(() => {
    if (champion && champion !== "__DECIDED__" && !celebratedRef.current) {
      celebratedRef.current = true;
      celebrate();
    }
  }, [champion]);

  if (!isDesktop) {
    // 1-Sided Mobile Bracket Tree View
    const halves = [
      { side: "left", r32: leftR32, r16: r16Left, qf: qfLeft, sf: sfLeft[0] },
      { side: "right", r32: rightR32, r16: r16Right, qf: qfRight, sf: sfRight[0] },
    ];

    return (
      <div className="bracket-outer">
        <div className="b-sticky-headers-bar" ref={headerRef}>
          <div className="b-mobile-headers">
            <div className="h-col">Round of 32</div>
            <div className="h-col">Round of 16</div>
            <div className="h-col">Quarter-finals</div>
            <div className="h-col">Semi-finals</div>
            <div className="h-col">Final</div>
          </div>
        </div>

        <div className="bracket-wrapper" onScroll={onHScroll}>
          <div className="b-mobile-container">
            <div className="b-mobile-flow">
              <div className="b-sf-pair left">
                {halves.map((h, hIdx) => (
                  <div className="b-sf-group left" key={hIdx}>
                    <div className="b-qf-pair left">
                      {[0, 2].map((qfIdx) => (
                        <div className="b-qf-group left" key={qfIdx}>
                          <div className="b-r16-pair left">
                            {[qfIdx, qfIdx + 1].map((r16Idx) => {
                              const r32Start = r16Idx * 2;
                              return (
                                <div className="b-r32-pair-node left" key={r16Idx}>
                                  <div className="b-r32-boxes left">
                                    <BracketMatchBox team1Code={h.r32[r32Start].t1} team2Code={h.r32[r32Start].t2} venueDate={h.r32[r32Start].venue} onOpen={onOpen} openTeam={openTeam} />
                                    <BracketMatchBox team1Code={h.r32[r32Start + 1].t1} team2Code={h.r32[r32Start + 1].t2} venueDate={h.r32[r32Start + 1].venue} onOpen={onOpen} openTeam={openTeam} />
                                  </div>
                                  <div className="b-target-box">
                                    <BracketMatchBox team1Code={h.r16[r16Idx].t1} team2Code={h.r16[r16Idx].t2} venueDate={h.r16[r16Idx].venue} onOpen={onOpen} openTeam={openTeam} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <div className="b-target-box">
                            <BracketMatchBox team1Code={h.qf[qfIdx / 2].t1} team2Code={h.qf[qfIdx / 2].t2} venueDate={h.qf[qfIdx / 2].venue} onOpen={onOpen} openTeam={openTeam} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="b-target-box">
                      <BracketMatchBox team1Code={h.sf.t1} team2Code={h.sf.t2} venueDate={h.sf.venue} onOpen={onOpen} openTeam={openTeam} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bracket-center">
              <BracketMatchBox team1Code={finalMatch.t1} team2Code={finalMatch.t2} venueDate={finalMatch.venue} onOpen={onOpen} openTeam={openTeam} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Desktop 2-Sided Tree View
  return (
    <div className="bracket-outer">
      <div className="b-sticky-headers-bar" ref={headerRef}>
        <div className="b-tree-headers">
          <div className="h-col">Round of 32</div>
          <div className="h-col">Round of 16</div>
          <div className="h-col">Quarter-finals</div>
          <div className="h-col">Semi-finals</div>
          <div className="h-col">Final</div>
          <div className="h-col">Semi-finals</div>
          <div className="h-col">Quarter-finals</div>
          <div className="h-col">Round of 16</div>
          <div className="h-col">Round of 32</div>
        </div>
      </div>

      <div className="bracket-wrapper" onScroll={onHScroll}>

      <div className="b-tree-container">
        {/* LEFT HALF */}
        <div className="b-half left">
          <div className="b-sf-group left">
            <div className="b-qf-pair left">
              {[0, 2].map((qfIdx) => (
                <div className="b-qf-group left" key={qfIdx}>
                  <div className="b-r16-pair left">
                    {[qfIdx, qfIdx + 1].map((r16Idx) => {
                      const r32Start = r16Idx * 2;
                      return (
                        <div className="b-r32-pair-node left" key={r16Idx}>
                          <div className="b-r32-boxes left">
                            <BracketMatchBox team1Code={leftR32[r32Start].t1} team2Code={leftR32[r32Start].t2} venueDate={leftR32[r32Start].venue} onOpen={onOpen} openTeam={openTeam} />
                            <BracketMatchBox team1Code={leftR32[r32Start + 1].t1} team2Code={leftR32[r32Start + 1].t2} venueDate={leftR32[r32Start + 1].venue} onOpen={onOpen} openTeam={openTeam} />
                          </div>
                          <div className="b-target-box">
                            <BracketMatchBox team1Code={r16Left[r16Idx].t1} team2Code={r16Left[r16Idx].t2} venueDate={r16Left[r16Idx].venue} onOpen={onOpen} openTeam={openTeam} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="b-target-box">
                    <BracketMatchBox team1Code={qfLeft[qfIdx / 2].t1} team2Code={qfLeft[qfIdx / 2].t2} venueDate={qfLeft[qfIdx / 2].venue} onOpen={onOpen} openTeam={openTeam} />
                  </div>
                </div>
              ))}
            </div>
            <div className="b-target-box">
              <BracketMatchBox team1Code={sfLeft[0].t1} team2Code={sfLeft[0].t2} venueDate={sfLeft[0].venue} onOpen={onOpen} openTeam={openTeam} />
            </div>
          </div>
        </div>

        {/* CENTER FINAL */}
        <div className="bracket-center">
          <BracketMatchBox team1Code={finalMatch.t1} team2Code={finalMatch.t2} venueDate={finalMatch.venue} onOpen={onOpen} openTeam={openTeam} />
        </div>

        {/* RIGHT HALF */}
        <div className="b-half right">
          <div className="b-sf-group right">
            <div className="b-qf-pair right">
              {[0, 2].map((qfIdx) => (
                <div className="b-qf-group right" key={qfIdx}>
                  <div className="b-r16-pair right">
                    {[qfIdx, qfIdx + 1].map((r16Idx) => {
                      const r32Start = r16Idx * 2;
                      return (
                        <div className="b-r32-pair-node right" key={r16Idx}>
                          <div className="b-r32-boxes right">
                            <BracketMatchBox team1Code={rightR32[r32Start].t1} team2Code={rightR32[r32Start].t2} venueDate={rightR32[r32Start].venue} onOpen={onOpen} openTeam={openTeam} />
                            <BracketMatchBox team1Code={rightR32[r32Start + 1].t1} team2Code={rightR32[r32Start + 1].t2} venueDate={rightR32[r32Start + 1].venue} onOpen={onOpen} openTeam={openTeam} />
                          </div>
                          <div className="b-target-box">
                            <BracketMatchBox team1Code={r16Right[r16Idx].t1} team2Code={r16Right[r16Idx].t2} venueDate={r16Right[r16Idx].venue} onOpen={onOpen} openTeam={openTeam} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="b-target-box">
                    <BracketMatchBox team1Code={qfRight[qfIdx / 2].t1} team2Code={qfRight[qfIdx / 2].t2} venueDate={qfRight[qfIdx / 2].venue} onOpen={onOpen} openTeam={openTeam} />
                  </div>
                </div>
              ))}
            </div>
            <div className="b-target-box">
              <BracketMatchBox team1Code={sfRight[0].t1} team2Code={sfRight[0].t2} venueDate={sfRight[0].venue} onOpen={onOpen} openTeam={openTeam} />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
);
}

/* ---------------- KNOCKOUTS ---------------- */
export function KnockoutsScreen({ go, onBack, openMatch, openTeam, openPerson }) {
  useSocial();
  const scrollRef = useRef(null);
  const { scrolled, onScroll } = useScrolled(scrollRef);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <AppHeader title="Knockouts" go={go} scrolled={scrolled}
        right={<button className="iconbtn" onClick={()=>go && go("standings")} aria-label="Standings"><span style={{fontSize:17}}>📊</span></button>} />
      <div className="scroll pad screen-anim ko-wrap" style={{flex:1}} ref={scrollRef} onScroll={onScroll}>
        <BracketView onOpen={openMatch} openTeam={openTeam} />
      </div>
    </div>
  );
}
