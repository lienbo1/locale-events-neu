const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new Map();

app.use(express.static(__dirname));

const EVENT_TERMS = [
  "Flohmarkt", "Trödelmarkt", "Stadtfest", "Kirmes", "Schützenfest",
  "Wochenmarkt", "Markt", "Familienfest", "Kinderfest", "Vereinsfest",
  "Feuerwehrfest", "Sommerfest", "Straßenfest", "Bürgerfest",
  "Weihnachtsmarkt", "Ostermarkt", "Kunstmarkt", "Oldtimertreffen",
  "Dorffest", "Weinfest", "verkaufsoffener Sonntag", "Veranstaltung"
];

const QUERY_GROUPS = [
  "Flohmarkt OR Trödelmarkt OR Markt",
  "Stadtfest OR Straßenfest OR Bürgerfest OR Dorffest",
  "Kirmes OR Schützenfest OR Vereinsfest OR Feuerwehrfest",
  "Familienfest OR Kinderfest OR Sommerfest",
  "Weihnachtsmarkt OR Ostermarkt OR Kunstmarkt OR Weinfest",
  "\"verkaufsoffener Sonntag\" OR Veranstaltung OR Veranstaltungen"
];

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function stripHtml(s=""){
  return s.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"')
    .replace(/&#39;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">")
    .replace(/\s+/g," ").trim();
}

function decodeXml(s=""){
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1")
    .replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,"<").replace(/&gt;/g,">");
}

function getTag(block, tag){
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]).trim() : "";
}

function parseRss(xml){
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map(b => ({
    title: stripHtml(getTag(b,"title")),
    link: stripHtml(getTag(b,"link")),
    description: stripHtml(getTag(b,"description")),
    pubDate: stripHtml(getTag(b,"pubDate")),
    source: stripHtml(getTag(b,"source"))
  }));
}

function normalizeTitle(t=""){
  return t.toLowerCase()
    .replace(/\s+-\s+[^-]{2,40}$/,"")
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .trim();
}

function classify(text=""){
  const t=text.toLowerCase();
  if(/flohmarkt|trödel/.test(t)) return "Flohmarkt";
  if(/weihnachtsmarkt|ostermarkt|kunstmarkt|wochenmarkt|\bmarkt\b/.test(t)) return "Markt";
  if(/kirmes/.test(t)) return "Kirmes";
  if(/schützenfest/.test(t)) return "Schützenfest";
  if(/familienfest|kinderfest/.test(t)) return "Familie";
  if(/vereinsfest|feuerwehrfest/.test(t)) return "Verein";
  if(/stadtfest|straßenfest|bürgerfest|dorffest|sommerfest|weinfest/.test(t)) return "Stadtfest";
  if(/verkaufsoffener sonntag/.test(t)) return "Shopping";
  return "Veranstaltung";
}

const MONTHS = {
  januar:1, februar:2, märz:3, maerz:3, april:4, mai:5, juni:6, juli:7,
  august:8, september:9, oktober:10, november:11, dezember:12
};

function inferEventDate(text, published){
  const now = new Date();
  const pubRaw = published ? new Date(published) : null;
  const pub = (pubRaw && !isNaN(pubRaw)) ? pubRaw : null;
  const clean = String(text||"").replace(/\s+/g," ").trim();
  const lower = clean.toLowerCase();

  function iso(y,m,d){
    return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  function dayOnly(d){
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function chooseYearFromPublication(month, day){
    // Ohne Veröffentlichungsdatum keine sichere Jahresableitung.
    if(!pub) return null;

    const baseYear = pub.getFullYear();
    const pubDay = dayOnly(pub);
    let candidate = new Date(baseYear, month-1, day);

    // Wenn das genannte Datum bereits deutlich vor der Veröffentlichung lag,
    // ist wahrscheinlich das Folgejahr gemeint.
    if(candidate < new Date(pubDay.getTime() - 14*86400000)){
      candidate = new Date(baseYear+1, month-1, day);
    }

    // Jahreslose lokale Veranstaltungshinweise müssen zeitlich plausibel
    // zur Veröffentlichung sein. Mehr als 9 Monate Abstand -> verwerfen.
    const diffDays = (candidate - pubDay) / 86400000;
    if(diffDays < -14 || diffDays > 275) return null;

    return candidate.getFullYear();
  }

  // Vollständiges Datum mit ausdrücklichem Jahr
  let m = clean.match(/\b([0-3]?\d)\.([01]?\d)\.(20\d{2})\b/);
  if(m) return iso(+m[3], +m[2], +m[1]);

  // Datumsbereich mit Monatsname und optionalem Jahr:
  // "29. bis 31. August 2026", "29.-31. August"
  m = lower.match(/\b([0-3]?\d)\.?\s*(?:-|–|bis)\s*([0-3]?\d)\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(20\d{2})?/);
  if(m){
    const month=MONTHS[m[3]], day=+m[1];
    const year=m[4] ? +m[4] : chooseYearFromPublication(month,day);
    return year ? iso(year,month,day) : null;
  }

  // Tag + Monatsname
  m = lower.match(/\b([0-3]?\d)\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\s*(20\d{2})?/);
  if(m){
    const month=MONTHS[m[2]], day=+m[1];
    const year=m[3] ? +m[3] : chooseYearFromPublication(month,day);
    return year ? iso(year,month,day) : null;
  }

  // Numerisches Datum ohne Jahr: "29.08."
  m = clean.match(/\b([0-3]?\d)\.([01]?\d)\.\b/);
  if(m){
    const day=+m[1], month=+m[2];
    const year=chooseYearFromPublication(month,day);
    return year ? iso(year,month,day) : null;
  }

  // Relative Angaben nur relativ zum Veröffentlichungsdatum interpretieren.
  // Ohne Veröffentlichungsdatum sind sie zu unsicher.
  if(!pub) return null;

  const base = dayOnly(pub);

  if(/\bheute\b/.test(lower)){
    return localISO(base);
  }

  if(/\bübermorgen\b|\buebermorgen\b/.test(lower)){
    const d=new Date(base); d.setDate(d.getDate()+2); return localISO(d);
  }

  if(/\bmorgen\b/.test(lower)){
    const d=new Date(base); d.setDate(d.getDate()+1); return localISO(d);
  }

  if(/\b(dieses|kommendes|am)\s+wochenende\b/.test(lower)){
    const day=base.getDay();
    const add=(6-day+7)%7;
    const d=new Date(base); d.setDate(d.getDate()+add);
    return localISO(d);
  }

  const weekdays = {
    sonntag:0, montag:1, dienstag:2, mittwoch:3,
    donnerstag:4, freitag:5, samstag:6
  };

  for(const [name,target] of Object.entries(weekdays)){
    const re = new RegExp(`\\b(?:am|diesen|kommenden|nächsten|naechsten)?\\s*${name}\\b`, "i");
    if(re.test(lower)){
      const d=new Date(base);
      let add=(target-d.getDay()+7)%7;
      // "am Samstag" in einem Samstagsartikel kann heute bedeuten;
      // "kommenden/nächsten Samstag" bedeutet dagegen die Folgewoche.
      if(add===0 && new RegExp(`\\b(?:kommenden|nächsten|naechsten)\\s+${name}\\b`,"i").test(lower)){
        add=7;
      }
      d.setDate(d.getDate()+add);
      return localISO(d);
    }
  }

  return null;
}
function localISO(d){
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

function periodBounds(mode){
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  let from=null,to=null;

  if(mode==="today"){
    from=today; to=today;
  }else if(mode==="7days"){
    from=today; to=new Date(today); to.setDate(to.getDate()+6);
  }else if(mode==="weekend"){
    const day=today.getDay();
    const daysToSat=(6-day+7)%7;
    from=new Date(today); from.setDate(from.getDate()+daysToSat);
    to=new Date(from); to.setDate(to.getDate()+1);
  }

  return {from:from?localISO(from):null,to:to?localISO(to):null};
}

function haversine(a,b){
  const R=6371, toRad=x=>x*Math.PI/180;
  const dLat=toRad(b.lat-a.lat), dLon=toRad(b.lon-a.lon);
  const la1=toRad(a.lat), la2=toRad(b.lat);
  const h=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

async function geocodePostcode(plz){
  const r = await fetch(`https://api.zippopotam.us/de/${encodeURIComponent(plz)}`);
  if(!r.ok) throw new Error("Postleitzahl nicht gefunden.");
  const data = await r.json();
  const p = data.places && data.places[0];
  if(!p) throw new Error("Postleitzahl nicht gefunden.");
  return {name:p["place name"], lat:+p.latitude, lon:+p.longitude};
}

async function nearbyPlaces(center, radiusKm){
  const radiusM = Math.min(Math.max(+radiusKm,5),100)*1000;
  const query = `[out:json][timeout:12];
    node(around:${radiusM},${center.lat},${center.lon})["place"~"city|town|village|suburb"];
    out tags center 100;`;

  try{
    const r = await fetch("https://overpass-api.de/api/interpreter", {
      method:"POST",
      headers:{
        "Content-Type":"application/x-www-form-urlencoded",
        "User-Agent":"Lokale-Events-App/1.0"
      },
      body:"data="+encodeURIComponent(query)
    });

    if(!r.ok) return [center.name];

    const data=await r.json();
    const seen=new Set([center.name.toLowerCase()]);
    const list=[{name:center.name,dist:0}];

    for(const el of data.elements||[]){
      const name=el.tags && el.tags.name;
      if(!name || seen.has(name.toLowerCase())) continue;
      const dist=haversine(center,{lat:el.lat,lon:el.lon});
      if(dist<=radiusKm){
        seen.add(name.toLowerCase());
        list.push({name,dist});
      }
    }

    return list.sort((a,b)=>a.dist-b.dist).slice(0,10).map(x=>x.name);
  }catch{
    return [center.name];
  }
}

async function googleNews(query){
  const url="https://news.google.com/rss/search?q="+encodeURIComponent(query)+
    "&hl=de&gl=DE&ceid=DE:de";
  const r=await fetch(url,{headers:{"User-Agent":"Lokale-Events-App/1.0"}});
  if(!r.ok) return [];
  return parseRss(await r.text());
}

function relevant(item, places){
  const t=(item.title+" "+item.description).toLowerCase();
  const hasEvent=EVENT_TERMS.some(x=>t.includes(x.toLowerCase()));
  const hasPlace=places.some(p=>t.includes(p.toLowerCase()));
  return hasEvent && hasPlace;
}

app.get("/api/events", async (req,res)=>{
  try{
    const plz=String(req.query.plz||"").trim();
    const radius=Math.min(Math.max(Number(req.query.radius)||50,5),100);
    const page=Math.max(Number(req.query.page)||0,0);
    const category=String(req.query.category||"").trim();
    const period=String(req.query.period||"all").trim();

    if(!/^\d{5}$/.test(plz)){
      return res.status(400).json({error:"Bitte eine fünfstellige deutsche PLZ eingeben."});
    }

    const key=`${plz}|${radius}|${category}|${period}`;
    let payload=cache.get(key);

    if(!payload || Date.now()-payload.time>10*60*1000){
      const center=await geocodePostcode(plz);
      const places=await nearbyPlaces(center,radius);
      const primaryPlaces=places.slice(0,8);
      let all=[];

      for(const group of QUERY_GROUPS){
        const placePart=primaryPlaces.map(p=>`"${p}"`).join(" OR ");
        const q=`(${placePart}) (${group})`;
        const items=await googleNews(q);
        all.push(...items);
        await sleep(120);
      }

      const dedup=new Map();

      for(const item of all){
        if(!relevant(item,primaryPlaces)) continue;

        const key2=normalizeTitle(item.title);
        if(!key2 || dedup.has(key2)) continue;

        const text=item.title+" "+item.description;
        const cat=classify(text);
        const eventDate=inferEventDate(text,item.pubDate);

        dedup.set(key2,{
          title:item.title,
          url:item.link,
          source:item.source || (item.title.includes(" - ")?item.title.split(" - ").pop():"Lokale Nachricht"),
          published:item.pubDate || null,
          eventDate,
          dateConfidence:eventDate ? "recognized" : "source_check",
          category:cat,
          matchedPlace:primaryPlaces.find(p=>text.toLowerCase().includes(p.toLowerCase())) || center.name
        });
      }

      let events=[...dedup.values()];

      if(category){
        events=events.filter(e=>e.category===category);
      }

      // Sehr alte Nachrichten sind als Quelle für aktuelle lokale Events unzuverlässig.
      // Standardmäßig nur Meldungen aus den letzten 365 Tagen berücksichtigen.
      const nowMs=Date.now();
      events=events.filter(e=>{
        if(!e.published) return true;
        const pd=new Date(e.published);
        if(isNaN(pd)) return true;
        return (nowMs-pd.getTime()) <= 365*86400000;
      });

      // Zukunftslogik mit zwei Vertrauensstufen:
      // 1) Erkannter Termin: nur ab heute anzeigen.
      // 2) Kein erkannter Termin: nur sehr aktuelle Meldungen (max. 30 Tage alt)
      //    anzeigen und im Frontend als "Termin in Quelle prüfen" kennzeichnen.
      const todayStr=localISO(new Date());
      events=events.filter(e=>{
        if(e.eventDate){
          return e.eventDate>=todayStr;
        }

        if(!e.published) return false;
        const pd=new Date(e.published);
        if(isNaN(pd)) return false;

        const ageDays=(Date.now()-pd.getTime())/86400000;
        return ageDays>=0 && ageDays<=30;
      });

      // Zeitfilter
      if(period!=="all"){
        const bounds=periodBounds(period);
        events=events.filter(e =>
          e.eventDate &&
          (!bounds.from || e.eventDate>=bounds.from) &&
          (!bounds.to || e.eventDate<=bounds.to)
        );
      }

      events.sort((a,b)=>{
        if(a.eventDate && b.eventDate) return a.eventDate.localeCompare(b.eventDate);
        if(a.eventDate) return -1;
        if(b.eventDate) return 1;
        return new Date(b.published||0)-new Date(a.published||0);
      });

      payload={time:Date.now(),center,places:primaryPlaces,events};
      cache.set(key,payload);
    }

    const perPage=10;
    const total=payload.events.length;
    const totalPages=Math.max(Math.ceil(total/perPage),1);
    const start=page*perPage;

    res.json({
      center:payload.center,
      searchedPlaces:payload.places,
      total,
      page,
      totalPages,
      events:payload.events.slice(start,start+perPage),
      note:"Erkannte vergangene Termine werden ausgeblendet. Hinweise ohne sicher erkennbares Veranstaltungsdatum erscheinen nur, wenn der Artikel höchstens 30 Tage alt ist; dort bitte den Termin in der Originalquelle prüfen."
    });

  }catch(e){
    res.status(500).json({error:e.message||"Suche fehlgeschlagen."});
  }
});

app.listen(PORT,()=>console.log(`Lokale Events App läuft auf Port ${PORT}`));
