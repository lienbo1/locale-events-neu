const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new Map();

app.use(express.static(__dirname));

const DAY = 86400000;

const CALENDARS = [
  {
    id:"marl", city:"Marl", lat:51.6563, lon:7.0906,
    source:"Stadt Marl – Veranstaltungskalender",
    url:"https://marl.de/rathaus-service/aktuelles/veranstaltungskalender/marl/kalender",
    parser:"generic"
  },
  {
    id:"recklinghausen", city:"Recklinghausen", lat:51.6138, lon:7.1974,
    source:"Stadt Recklinghausen – Veranstaltungskalender",
    url:"https://www.recklinghausen.de/Inhalte/Startseite/_Veranstaltungskalender/index.asp?db=79&fieldStadt=Recklinghausen&form=list&orderby=fieldgkdveranstbeginn",
    parser:"recklinghausen"
  },
  {
    id:"herten", city:"Herten", lat:51.5964, lon:7.1439,
    source:"Stadt Herten – Veranstaltungskalender",
    url:"https://www.herten.de/stadtleben/veranstaltungskalender",
    parser:"generic"
  },
  {
    id:"dorsten", city:"Dorsten", lat:51.6617, lon:6.9651,
    source:"StadtAgentur Dorsten – Veranstaltungskalender",
    url:"https://stadtagentur-dorsten.de/events/",
    parser:"generic"
  },
  {
    id:"haltern", city:"Haltern am See", lat:51.7433, lon:7.1817,
    source:"Stadt Haltern am See – Veranstaltungshighlights",
    url:"https://www.haltern-am-see.de/veranstaltungsuebersicht",
    parser:"generic"
  },
  {
    id:"haltern-local", city:"Haltern am See", lat:51.7433, lon:7.1817,
    source:"Haltern Online – Veranstaltungskalender",
    url:"https://haltern-online.de/events/",
    parser:"generic"
  },
  {
    id:"gelsenkirchen", city:"Gelsenkirchen", lat:51.5177, lon:7.0857,
    source:"Visit Gelsenkirchen – Events",
    url:"https://visit.gelsenkirchen.de/de/Events/index.aspx",
    parser:"generic"
  }
];

const EVENT_TERMS = [
  "Flohmarkt","Trödelmarkt","Stadtfest","Kirmes","Schützenfest","Wochenmarkt",
  "Markt","Familienfest","Kinderfest","Vereinsfest","Feuerwehrfest","Sommerfest",
  "Straßenfest","Bürgerfest","Weihnachtsmarkt","Ostermarkt","Kunstmarkt",
  "Oldtimertreffen","Dorffest","Weinfest","verkaufsoffener Sonntag",
  "Konzert","Theater","Ausstellung","Festival","Führung","Lesung","Sport"
];

const QUERY_GROUPS = [
  "Flohmarkt OR Trödelmarkt OR Markt",
  "Stadtfest OR Straßenfest OR Bürgerfest OR Dorffest",
  "Kirmes OR Schützenfest OR Vereinsfest OR Feuerwehrfest",
  "Familienfest OR Kinderfest OR Sommerfest",
  "Konzert OR Theater OR Ausstellung OR Festival",
  "\"verkaufsoffener Sonntag\" OR Veranstaltung OR Veranstaltungen"
];

const MONTHS = {
  januar:1,februar:2,märz:3,maerz:3,april:4,mai:5,juni:6,juli:7,
  august:8,september:9,oktober:10,november:11,dezember:12,
  jan:1,feb:2,mär:3,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,okt:10,nov:11,dez:12
};

function localISO(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}
function parseDMY(d,m,y){
  y=+y; if(y<100) y+=2000;
  return `${y}-${String(+m).padStart(2,"0")}-${String(+d).padStart(2,"0")}`;
}
function decodeHtml(s=""){
  return s.replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
    .replace(/&auml;/gi,"ä").replace(/&ouml;/gi,"ö").replace(/&uuml;/gi,"ü")
    .replace(/&Auml;/g,"Ä").replace(/&Ouml;/g,"Ö").replace(/&Uuml;/g,"Ü")
    .replace(/&szlig;/gi,"ß").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n));
}
function stripTags(s=""){
  return decodeHtml(s.replace(/<script\b[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim());
}
function htmlToLines(html=""){
  let s=html.replace(/<script\b[\s\S]*?<\/script>/gi," ")
    .replace(/<style\b[\s\S]*?<\/style>/gi," ")
    .replace(/<\/?(?:div|p|li|tr|td|th|h[1-6]|article|section|br|time)[^>]*>/gi,"\n")
    .replace(/<[^>]+>/g," ");
  return decodeHtml(s).split(/\n+/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
}
function normalizeTitle(t=""){
  return t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu," ").trim();
}
function classify(text=""){
  const t=text.toLowerCase();
  if(/flohmarkt|trödel/.test(t)) return "Flohmarkt";
  if(/kirmes/.test(t)) return "Kirmes";
  if(/schützenfest/.test(t)) return "Schützenfest";
  if(/familienfest|kinderfest/.test(t)) return "Familie";
  if(/vereinsfest|feuerwehrfest/.test(t)) return "Verein";
  if(/weihnachtsmarkt|ostermarkt|kunstmarkt|wochenmarkt|\bmarkt\b/.test(t)) return "Markt";
  if(/stadtfest|straßenfest|bürgerfest|dorffest|sommerfest|weinfest/.test(t)) return "Stadtfest";
  if(/verkaufsoffener sonntag/.test(t)) return "Shopping";
  if(/konzert|musik|festival/.test(t)) return "Musik";
  if(/theater|lesung|ausstellung|museum|führung/.test(t)) return "Kultur";
  if(/sport|lauf|fitness/.test(t)) return "Sport";
  return "Veranstaltung";
}
function haversine(a,b){
  const R=6371,toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat),dLon=toRad(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
async function fetchText(url){
  const r=await fetch(url,{headers:{
    "User-Agent":"Mozilla/5.0 (compatible; LokaleEventsApp/2.0; +https://render.com/)",
    "Accept-Language":"de-DE,de;q=0.9"
  }});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}
async function geocodePostcode(plz){
  const r=await fetch(`https://api.zippopotam.us/de/${encodeURIComponent(plz)}`);
  if(!r.ok) throw new Error("Postleitzahl nicht gefunden.");
  const data=await r.json();
  const p=data.places&&data.places[0];
  if(!p) throw new Error("Postleitzahl nicht gefunden.");
  return {name:p["place name"],lat:+p.latitude,lon:+p.longitude};
}
function periodBounds(mode){
  const today=new Date(); today.setHours(0,0,0,0);
  let from=today,to=null;
  if(mode==="today") to=today;
  else if(mode==="7days"){to=new Date(today);to.setDate(to.getDate()+6);}
  else if(mode==="weekend"){
    const add=(6-today.getDay()+7)%7;
    from=new Date(today);from.setDate(from.getDate()+add);
    to=new Date(from);to.setDate(to.getDate()+1);
  }
  return {from:localISO(from),to:to?localISO(to):null};
}
function extractDateFromText(text, fallbackYear=new Date().getFullYear()){
  const s=String(text||"");
  let m=s.match(/\b([0-3]?\d)\.([01]?\d)\.(20\d{2}|\d{2})\b/);
  if(m) return parseDMY(m[1],m[2],m[3]);

  m=s.toLowerCase().match(/\b([0-3]?\d)\.?\s*(?:-|–|bis)\s*([0-3]?\d)\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(20\d{2})?/);
  if(m){
    const mo=MONTHS[m[3]], y=m[4]?+m[4]:fallbackYear;
    return parseDMY(m[1],mo,y);
  }

  m=s.toLowerCase().match(/\b([0-3]?\d)\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(20\d{2})?/);
  if(m){
    const mo=MONTHS[m[2]], y=m[3]?+m[3]:fallbackYear;
    return parseDMY(m[1],mo,y);
  }

  m=s.toLowerCase().match(/\b([0-3]?\d)\s+(jan|feb|mär|mar|apr|mai|jun|jul|aug|sep|sept|okt|nov|dez)\.?\b/);
  if(m){
    let y=fallbackYear;
    const mo=MONTHS[m[2]];
    const d=new Date(y,mo-1,+m[1]);
    const today=new Date();today.setHours(0,0,0,0);
    if(d<new Date(today.getTime()-30*DAY)) y++;
    return parseDMY(m[1],mo,y);
  }
  return null;
}
function isNoise(line=""){
  const t=line.toLowerCase();
  return !line || line.length<3 || line.length>180 ||
    /^(start|ende|weitere termine|veranstaltungen finden|veranstaltung vorschlagen|mehr|details|zurück|termin speichern)$/i.test(line) ||
    /^\d{1,2}:\d{2}/.test(line) || /^\d{1,2}\.?$/.test(line) ||
    /^(jan|feb|mär|mar|apr|mai|jun|jul|aug|sep|okt|nov|dez)$/i.test(line);
}
function titleCandidate(lines,i){
  // same line after a date may already contain useful title
  const same=lines[i].replace(/\b\d{1,2}[.\s-]+(?:\d{1,2}[.\s-]+)?(?:20)?\d{2,4}\b/g,"")
    .replace(/\b\d{1,2}\s+(?:jan|feb|mär|mar|apr|mai|jun|jul|aug|sep|sept|okt|nov|dez)\.?\b/gi,"")
    .replace(/\b\d{1,2}:\d{2}\b/g,"").replace(/^[\s|•–-]+/,"").trim();
  if(!isNoise(same) && same.length>=5) return same;

  for(const offset of [-1,1,-2,2,-3,3]){
    const x=lines[i+offset];
    if(x && !isNoise(x) && !extractDateFromText(x)) return x;
  }
  return null;
}
function parseGenericCalendar(html,src){
  const lines=htmlToLines(html);
  const out=[];
  const year=new Date().getFullYear();

  for(let i=0;i<lines.length;i++){
    const date=extractDateFromText(lines[i],year);
    if(!date) continue;
    const title=titleCandidate(lines,i);
    if(!title) continue;

    out.push({
      title,
      eventDate:date,
      matchedPlace:src.city,
      source:src.source,
      url:src.url,
      category:classify(title+" "+lines.slice(Math.max(0,i-2),i+3).join(" ")),
      sourceType:"Kalender"
    });
  }
  return out;
}
function parseRecklinghausen(html,src){
  const out=[];
  const rows=html.match(/<tr\b[\s\S]*?<\/tr>/gi)||[];
  for(const row of rows){
    const cells=[...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m=>stripTags(m[1]));
    if(cells.length<2) continue;
    const date=extractDateFromText(cells[1]);
    const title=cells[0];
    if(!date || !title || /veranstaltung/i.test(title) && /beginn/i.test(cells[1])) continue;
    out.push({
      title,eventDate:date,matchedPlace:"Recklinghausen",
      source:src.source,url:src.url,category:classify(title),sourceType:"Kalender"
    });
  }
  return out;
}
async function loadCalendar(src){
  try{
    const html=await fetchText(src.url);
    const events=src.parser==="recklinghausen" ? parseRecklinghausen(html,src) : parseGenericCalendar(html,src);
    return events.slice(0,160);
  }catch(e){
    console.log("Kalender konnte nicht geladen werden:",src.city,e.message);
    return [];
  }
}

// Nachrichten bleiben nur Zusatzquelle
function parseRss(xml){
  const items=xml.match(/<item\b[\s\S]*?<\/item>/gi)||[];
  const tag=(b,n)=>{const m=b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`,"i"));return m?stripTags(m[1].replace(/<!\[CDATA\[|\]\]>/g,"")):""};
  return items.map(b=>({title:tag(b,"title"),link:tag(b,"link"),description:tag(b,"description"),pubDate:tag(b,"pubDate"),source:tag(b,"source")}));
}
async function googleNews(query){
  try{
    const url="https://news.google.com/rss/search?q="+encodeURIComponent(query)+"&hl=de&gl=DE&ceid=DE:de";
    return parseRss(await fetchText(url));
  }catch{return [];}
}
async function newsEvents(center,nearCities){
  let all=[];
  const names=[center.name,...nearCities].slice(0,6);
  for(const group of QUERY_GROUPS){
    const q=`(${names.map(n=>`"${n}"`).join(" OR ")}) (${group})`;
    const items=await googleNews(q);
    for(const item of items){
      const txt=item.title+" "+item.description;
      if(!EVENT_TERMS.some(x=>txt.toLowerCase().includes(x.toLowerCase()))) continue;
      const eventDate=extractDateFromText(txt,new Date(item.pubDate||Date.now()).getFullYear());
      if(!eventDate) continue;
      all.push({
        title:item.title,eventDate,
        matchedPlace:names.find(n=>txt.toLowerCase().includes(n.toLowerCase()))||center.name,
        source:item.source||"Lokale Nachricht",url:item.link,
        category:classify(txt),sourceType:"Nachricht"
      });
    }
  }
  return all;
}

app.get("/api/events",async(req,res)=>{
  try{
    const plz=String(req.query.plz||"").trim();
    const radius=Math.min(Math.max(Number(req.query.radius)||50,5),100);
    const page=Math.max(Number(req.query.page)||0,0);
    const category=String(req.query.category||"").trim();
    const period=String(req.query.period||"all").trim();
    if(!/^\d{5}$/.test(plz)) return res.status(400).json({error:"Bitte eine gültige fünfstellige deutsche PLZ eingeben."});

    const cacheKey=`v7|${plz}|${radius}|${category}|${period}`;
    const cached=cache.get(cacheKey);
    if(cached && Date.now()-cached.time<10*60*1000) return res.json(cached.payload);

    const center=await geocodePostcode(plz);
    const activeSources=CALENDARS.filter(s=>haversine(center,s)<=radius+8);
    const nearCities=activeSources.map(s=>s.city).filter((v,i,a)=>a.indexOf(v)===i);

    const calendarGroups=await Promise.all(activeSources.map(loadCalendar));
    let events=calendarGroups.flat();

    // Ergänzende Nachrichten
    const extra=await newsEvents(center,nearCities);
    events.push(...extra);

    // Zukunft + Zeitraum
    const today=localISO(new Date());
    events=events.filter(e=>e.eventDate && e.eventDate>=today);

    const bounds=periodBounds(period);
    if(period!=="all"){
      events=events.filter(e=>e.eventDate>=bounds.from && (!bounds.to || e.eventDate<=bounds.to));
    }

    if(category){
      events=events.filter(e=>e.category===category);
    }

    // Dubletten: gleicher/ähnlicher Titel am selben Tag
    const dedup=new Map();
    for(const e of events){
      const key=e.eventDate+"|"+normalizeTitle(e.title).slice(0,90);
      const old=dedup.get(key);
      // Kalenderquelle hat Vorrang vor Nachricht
      if(!old || (old.sourceType!=="Kalender" && e.sourceType==="Kalender")) dedup.set(key,e);
    }
    events=[...dedup.values()].sort((a,b)=>a.eventDate.localeCompare(b.eventDate)||a.title.localeCompare(b.title,"de"));

    const perPage=10,total=events.length,totalPages=Math.max(1,Math.ceil(total/perPage));
    const safePage=Math.min(page,totalPages-1);
    const payload={
      center,
      searchedPlaces:nearCities,
      sources:activeSources.map(s=>s.source),
      total,page:safePage,totalPages,
      events:events.slice(safePage*perPage,safePage*perPage+perPage),
      note:"Direkte Veranstaltungskalender haben Vorrang. Lokale Nachrichten werden nur ergänzend genutzt. Vergangene Termine werden ausgeblendet."
    };
    cache.set(cacheKey,{time:Date.now(),payload});
    res.json(payload);
  }catch(e){
    console.error(e);
    res.status(500).json({error:e.message||"Suche fehlgeschlagen."});
  }
});

app.listen(PORT,()=>console.log(`Lokale Events App v7 läuft auf Port ${PORT}`));
