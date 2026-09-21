// Catalogue operators verified against FAA JO 7340.2P, section 3-3:
// https://www.faa.gov/air_traffic/publications/atpubs/cnt_html/chap3_section_3.html
// MSC and SXS have no telephony entry there: retain the identifier unless the
// track supplies radioCallsign explicitly, rather than guessing a spoken name.
export const RADIO_OPERATORS=Object.freeze({
  AEE:'AEGEAN',AFR:'AIRFRANS',AUA:'AUSTRIAN',BAW:'SPEEDBIRD',BBG:'CANDIA BIRD',
  BLX:'BLUESCAN',BTI:'AIRBALTIC',CAI:'CORENDON',DLA:'DOLOMITI',DLH:'LUFTHANSA',
  EJU:'ALPINE',ELY:'ELAL',ENT:'ENTERAIR',ETH:'ETHIOPIAN',EWG:'EUROWINGS',
  FHY:'FREEBIRD AIR',FIN:'FINNAIR',HST:'HESTON',KLM:'KLM',LOT:'LOT',MGH:'MAVI',
  NMA:'NESMA',NOZ:'NORDIC',NSZ:'REDNOSE',NVD:'NORDVIND',PGT:'SUNTURK',QTR:'QATARI',
  RYR:'RYANAIR',SAS:'SCANDINAVIAN',SWR:'SWISS',TAY:'QUALITY',THY:'TURKISH',
  TVP:'JET TRAVEL',UAE:'EMIRATES',VKG:'VIKING',WMT:'WIZZ MALTA',WZZ:'WIZZAIR',
});

export function radioCallsign(track){
  if(track?.radioCallsign)return String(track.radioCallsign).trim().toUpperCase();
  const callsign=String(track?.callsign || '').trim().toUpperCase();
  const match=/^([A-Z]{3})([0-9][A-Z0-9]*)$/.exec(callsign);
  return match ? `${RADIO_OPERATORS[match[1]] || match[1]} ${match[2]}` : callsign;
}
