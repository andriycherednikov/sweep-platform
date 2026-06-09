// Real Sweep roster — transcribed from the organizer's two handwritten sheets (2026-06-09).
// Each player owns one Pool A team and one Pool B team; codes match the `team` table.
// Invariant (asserted in roster.test.js): 48 players, 96 picks, every one of the 48 teams
// owned by exactly two players.
export const roster = [
  // ---- sheet 1 ----
  { name: 'Hugo Wood', teams: ['jp', 'cpv'] },          // Japan / Cabo Verde
  { name: 'Lachlan Wood', teams: ['at', 'nz'] },        // Austria / New Zealand
  { name: 'Havill Family', teams: ['nl', 'py'] },       // Netherlands / Paraguay
  { name: 'Andy Dean', teams: ['at', 'dz'] },           // Austria / Algeria
  { name: 'Zoe Dean', teams: ['tr', 'cpv'] },           // Turkey / Cabo Verde
  { name: 'Huxley Dean', teams: ['be', 'ca'] },         // Belgium / Canada
  { name: 'Harry Dean', teams: ['pt', 'pan'] },         // Portugal / Panama
  { name: 'Grant Holland', teams: ['de', 'gh'] },       // Germany / Ghana
  { name: 'Sarah Holland', teams: ['gb-eng', 'ec'] },   // England / Ecuador
  { name: 'Skye Holland', teams: ['ir', 'eg'] },        // Iran / Egypt
  { name: 'Jake Holland', teams: ['ch', 'sa'] },        // Switzerland / Saudi Arabia
  { name: 'Darius Afshar', teams: ['se', 'tn'] },       // Sweden / Tunisia
  { name: 'Sarah Afshar', teams: ['sn', 'qa'] },        // Senegal / Qatar
  { name: 'Eva Afshar', teams: ['be', 'cur'] },         // Belgium / Curaçao
  { name: 'Mia Afshar', teams: ['us', 'cur'] },         // USA / Curaçao
  { name: 'Ben Spooner', teams: ['fr', 'ec'] },         // France / Ecuador
  { name: 'Abi Spooner', teams: ['ma', 'hai'] },        // Morocco / Haiti
  { name: 'Jax Spooner', teams: ['uy', 'qa'] },         // Uruguay / Qatar
  { name: 'Zac Spooner', teams: ['ar', 'sco'] },        // Argentina (Uruguay crossed out) / Scotland
  { name: 'Jake Smith', teams: ['gb-eng', 'ci'] },      // England / Ivory Coast
  { name: 'Nixon Smith', teams: ['uy', 'jor'] },        // Uruguay / Jordan
  { name: 'Rochelle Smith', teams: ['no', 'ca'] },      // Norway / Canada
  { name: 'Clive Lee', teams: ['kr', 'uzb'] },          // South Korea / Uzbekistan
  { name: 'Heather Lee', teams: ['sn', 'cze'] },        // Senegal / Czechia
  { name: 'Harrison Lee', teams: ['mx', 'nz'] },        // Mexico / New Zealand
  // ---- sheet 2 ----
  { name: 'Jesse Lee', teams: ['co', 'bih'] },          // Colombia / Bosnia & Herzegovina
  { name: 'Matt Hart', teams: ['se', 'cze'] },          // Sweden / Czechia
  { name: 'Jade Hart', teams: ['co', 'irq'] },          // Colombia / Iraq
  { name: 'Kingston Hart', teams: ['nl', 'sa'] },       // Netherlands / Saudi Arabia
  { name: 'Mark Cullinane', teams: ['ar', 'sco'] },     // Argentina / Scotland
  { name: 'Val Cullinane', teams: ['br', 'cgo'] },      // Brazil / Congo DR
  { name: 'Eva Cullinane', teams: ['hr', 'pan'] },      // Croatia / Panama
  { name: 'Harry Laidsaar', teams: ['no', 'au'] },      // Norway / Australia
  { name: 'Max Laidsaar', teams: ['ma', 'jor'] },       // Morocco / Jordan
  { name: 'Sam Laidsaar', teams: ['kr', 'cgo'] },       // South Korea / Congo DR
  { name: 'Sue Powell', teams: ['us', 'hai'] },         // USA / Haiti
  { name: 'Ben Bourke', teams: ['es', 'za'] },          // Spain / South Africa
  { name: 'Cass Bourke', teams: ['br', 'uzb'] },        // Brazil / Uzbekistan
  { name: 'River Bourke', teams: ['ch', 'py'] },        // Switzerland / Paraguay
  { name: 'Remy Bourke', teams: ['mx', 'au'] },         // Mexico / Australia
  { name: 'Mark Bazevski', teams: ['es', 'ci'] },       // Spain / Ivory Coast
  { name: 'Eddie Bazevski', teams: ['jp', 'tn'] },      // Japan / Tunisia
  { name: 'Nick Heath', teams: ['pt', 'eg'] },          // Portugal / Egypt
  { name: 'Jude Heath', teams: ['tr', 'dz'] },          // Türkiye / Algeria
  { name: 'Andriy Cherednikov', teams: ['hr', 'bih'] }, // Croatia / Bosnia & Herzegovina
  { name: 'Leonard Cherednikov', teams: ['de', 'gh'] }, // Germany / Ghana
  { name: 'Chris Pullin-Lopez', teams: ['ir', 'irq'] }, // Iran / Iraq
  { name: 'Carolina Pullin-Lopez', teams: ['fr', 'za'] }, // France / South Africa
]
