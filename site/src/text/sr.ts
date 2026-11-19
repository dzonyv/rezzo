// Everything the site says in Serbian (Latin script). en.ts has the same
// shape; the templates hold no text of their own.

export const sr = {
  common: {
    skip: 'Preskoči na sadržaj',
    navLabel: 'Glavna navigacija',
    footerNavLabel: 'Linkovi u podnožju',
    nav: {
      howItWorks: 'Kako radi',
      guide: 'Uputstvo',
      github: 'GitHub',
      download: 'Preuzmi',
    },
    otherLang: 'English',
    otherLangLabel: 'Sajt na engleskom',
    homeLabel: 'Rezzo, početna',
    license: 'Rezzo je slobodan softver pod licencom GPL-3.0.',
    madeBy: 'Napravio',
    report: 'Prijavi problem',
    changes: 'Izmene',
    licenses: 'Licence',
    credit:
      'Slike ekrana prikazuju kadrove iz filma Tears of Steel, (CC) Blender Foundation | mango.blender.org, pod licencom CC BY 3.0.',
    downloadButton: 'Preuzmi instalater',
    downloadForWindows: 'Preuzmi za Windows',
    version: (v: string) => `Verzija ${v}`,
    notPublished: 'uskoro na GitHubu',
    megabytes: (mb: number) => `${mb.toLocaleString('sr-Latn')} MB`,
    editorAlt:
      'Klip u Rezzo editoru: transkript levo, vertikalni pregled sa dvoje govornika jedno iznad drugog u sredini i vremenska linija sa slojevima ispod',
    episodeAlt:
      'Ekran epizode: video i pronađeni glasovi levo, transkript u sredini, klipovi desno i cela epizoda u traci na dnu',
  },

  home: {
    title: 'Rezzo: besplatan program za klipove iz podkasta',
    description:
      'Rezzo je besplatan open source program za Windows koji od cele epizode pravi vertikalne klipove sa titlovima. Bez watermarka i bez pretplate.',
    kicker: 'Besplatno · open source · Windows',
    h1: 'Besplatan program za klipove iz podkasta',
    lead: 'Rezzo ispiše epizodu u transkript. Ti izabereš rečenice, a on iseče klip u 9:16, drži u kadru onoga ko govori i doda titlove reč po reč.',
    clipAlt: 'Gotov vertikalni klip: dvoje govornika jedno iznad drugog i titl između njih',
    clipCaption: '1080×1920, bez watermarka',
    noneLabel: 'Čega u Rezzu nema',
    none: ['Watermark: nema', 'Pretplata: nema', 'Plaćena verzija: nema'],
    editorCaption: 'Editor klipa. Ono što vidiš u pregledu je ono što izađe u fajlu.',
    howId: 'kako-radi',
    howTitle: 'Kako radi',
    steps: [
      {
        title: 'Ubaci epizodu',
        text: 'Pritisneš Transkribuj i Rezzo ispiše celu epizodu, sa vremenom za svaku reč.',
      },
      {
        title: 'Označi rečenice',
        text: 'One postaju klip. Rezzo nađe rezove kamere i ljude u kadru, a Automatski kadar bira raspored za svaki kadar.',
      },
      {
        title: 'Doteraj i izvezi',
        text: 'Titlovi, pauze, slike, zvuk. Izvoz je MP4 1080×1920 i izgleda isto kao pregled u editoru.',
      },
    ],
    featuresId: 'mogucnosti',
    featuresTitle: 'Šta sve ume',
    features: [
      {
        title: 'Transkript',
        text: 'Uvek latinicom, i kad model vrati ćirilicu. Pretražuješ ga dok video ide i ispravljaš reči sa tastature. Reč koju model stalno greši staviš na listu zamena i više je ne ispravljaš.',
      },
      {
        title: 'Kadriranje',
        text: 'Prati onoga ko govori, slaže dvoje jedno iznad drugog ili stavlja celu sliku preko njene zamućene kopije. Sve su to obični keyframe-ovi, pa svaki možeš da promeniš ručno.',
      },
      {
        title: 'Titlovi',
        text: 'Pojavljuju se reč po reč i označavaju reč koja se izgovara. Font, boje, obrub i broj reči u redu podesiš jednom i sačuvaš kao svoj stil.',
      },
      {
        title: 'Pauze',
        text: 'Rezzo ih nalazi u zvuku i pokaže na vremenskoj liniji pre nego što išta iseče. Isto tako izbaciš „ovaj“ ili pogrešan početak. Svaki rez se vraća jednim klikom.',
      },
      {
        title: 'Slojevi i zvuk',
        text: 'Slike, video sa zelenim platnom, Lottie animacije, efekti, zvučni efekti i muzika. Muzika se sama stiša dok neko priča.',
      },
      {
        title: 'Naslovna slika',
        text: 'Svaki klip dobije naslovnu: kadar iz klipa ili tvoja slika, naslov, ljudi izdvojeni ispred njega i šabloni koje možeš da ponoviš.',
      },
    ],
    episodeCaption: 'Ekran epizode: transkript u sredini, glasovi levo, klipovi desno.',
    whyTitle: 'Zašto je besplatan',
    why: [
      'Kačim klipove iz podkasta i posao je svaki put isti: nađi dobar momenat, iseci široki kadar na 9:16, drži u kadru onoga ko govori, dodaj titlove.',
      'Programi koji to rade dobro ili lepe watermark na video ili korisne stvari drže iza mesečne pretplate. Rezzo radi isti posao besplatno, i sve je u besplatnoj verziji jer druge verzije nema.',
    ],
    signature: 'Nikola, autor. Kod je na',
    faqId: 'pitanja',
    faqTitle: 'Pitanja',
    faq: [
      {
        q: 'Da li je stvarno besplatan?',
        a: 'Jeste. Nema plaćene verzije, probnog perioda ni naloga. Kod je na GitHubu pod licencom GPL-3.0, pa svako može da ga pogleda i sam izgradi.',
      },
      {
        q: 'Treba li mi NVIDIA kartica?',
        a: 'Ne treba. Sa njom transkripcija i izvoz idu mnogo brže, a bez nje rade na procesoru.',
      },
      {
        q: 'Da li Rezzo negde šalje moj video?',
        a: 'Ne. Video i transkript ostaju na tvom računaru. Program ide na internet kad prvi put transkribuješ, da preuzme whisper.cpp i model za govor.',
      },
      {
        q: 'Na kom jeziku radi transkripcija?',
        a: 'Rezzo je pravljen za emisije na srpskom. Tekst je uvek latinicom, čak i kad model vrati ćirilicu.',
      },
      {
        q: 'Radi li na Macu ili Linuxu?',
        a: 'Još ne. Za sada samo Windows, a macOS i Linux su na planu.',
      },
      {
        q: 'Zašto Windows upozorava kad pokrenem instalater?',
        a: 'Instalater još nije potpisan, pa SmartScreen upozori prvi put. Klikni „More info“, pa „Run anyway“.',
      },
    ],
    downloadId: 'preuzmi',
    downloadTitle: 'Preuzmi Rezzo',
    downloadNotes: [
      'Za sada radi samo na Windowsu. macOS i Linux su na planu.',
      'Instalira se za tvoj nalog i ne traži administratorska prava.',
      'NVIDIA kartica ubrzava transkripciju i izvoz, ali nije obavezna.',
      'Pri prvoj transkripciji preuzima se model za govor, sa NVIDIA karticom oko 1,3 GB.',
    ],
    downloadMore: 'Sve o instalaciji',
  },

  download: {
    title: 'Preuzmi Rezzo za Windows',
    description:
      'Instalater za Windows, šta ti treba od računara i kako da prođeš upozorenje SmartScreena. Rezzo je besplatan i nema watermark.',
    h1: 'Preuzmi Rezzo',
    lead: 'Jedan instalater za Windows. Nema naloga, probnog perioda ni plaćene verzije.',
    checksum: 'SHA256 zbir instalatera je u izdanju na GitHubu.',
    allReleases: 'Sva izdanja',
    needsTitle: 'Šta ti treba',
    needs: [
      'Windows 10 ili 11, 64-bitni.',
      'NVIDIA kartica nije obavezna. Sa njom transkripcija i izvoz idu mnogo brže, a bez nje rade na procesoru.',
      'Mesto na disku za model za govor. Sa NVIDIA karticom to je oko 1,3 GB.',
    ],
    installTitle: 'Instalacija',
    install: [
      'Preuzmi instalater i pokreni ga.',
      'Windows SmartScreen upozori prvi put jer instalater još nije potpisan. Klikni „More info“, pa „Run anyway“.',
      'Rezzo se instalira za tvoj nalog i ne traži administratorska prava.',
      'Prvi put kad pritisneš Transkribuj, Rezzo preuzme whisper.cpp i model za govor u %LOCALAPPDATA%\\Rezzo.',
    ],
    removeTitle: 'Uklanjanje',
    remove:
      'Deinstalacija ostavlja model u %LOCALAPPDATA%\\Rezzo, pa ga ponovna instalacija ne preuzima iznova. „Prostor na disku“ na početnom ekranu pokazuje šta Rezzo tu drži i briše to.',
    buildTitle: 'Sam iz koda',
    build: 'Treba ti Windows i Node 24. Ova tri koraka pokreću program iz koda, a ostalo piše u README fajlu.',
    readme: 'README na GitHubu',
  },

  guide: {
    title: 'Uputstvo: od epizode do klipa | Rezzo',
    description:
      'Kako se u Rezzu pravi vertikalni klip: transkript, izbor rečenica, kadar, titlovi, pauze, slojevi, naslovna i izvoz.',
    h1: 'Od epizode do klipa',
    lead: 'Ovo je ceo put, od cele epizode do gotovog MP4 fajla. Nazivi dugmadi su onakvi kakve ih vidiš u programu.',
    sections: [
      {
        id: 'transkript',
        title: 'Transkript',
        text: [
          'Otvori epizodu i pritisni Transkribuj. Rezzo zapiše šta se govori i svakoj reči da vreme. Tekst je uvek latinicom, čak i kad model vrati ćirilicu.',
          'Dok video ide, pretražuješ transkript (Ctrl+F) i ispravljaš pogrešne reči jednu za drugom sa tastature. Reči koje model greši svaki put idu u Zamene, pa su u svakom sledećem transkriptu već ispravljene.',
          'Rezzo razlikuje glasove u epizodi i boji ih u traci na dnu ekrana. Ako je jedna osoba dobila dva glasa, spojiš ih u kartici Glasovi.',
        ],
        image: 'episode',
      },
      {
        id: 'klip',
        title: 'Klip od rečenica',
        text: [
          'Označi nekoliko rečenica u transkriptu i od njih napravi klip. Klip se otvara u editoru, a Rezzo u njemu traži rezove kamere i ljude u kadru.',
        ],
      },
      {
        id: 'kadar',
        title: 'Kadar',
        text: [
          'Automatski kadar za svaki kadar kamere bira jedan od tri rasporeda: Praćenje drži u kadru onoga ko govori, Podeljeno slaže dvoje jedno iznad drugog, a Ceo kadar stavlja celu sliku preko njene zamućene kopije.',
          'Na širokom kadru Rezzo sam ne zna ko priča. Uključi Prikaži ljude i klikni na onoga ko govori. Taj jedan klik mu kaže gde taj glas sedi do kraja epizode.',
          'Sve što Automatski kadar uradi su obični keyframe-ovi, pa svaki možeš da pomeriš ili obrišeš.',
        ],
        image: 'clip',
      },
      {
        id: 'titlovi',
        title: 'Titlovi',
        text: [
          'Svaki klip dobija titlove koji se pojavljuju reč po reč i označavaju reč koja se izgovara. Ima nekoliko gotovih stilova, a font, boje, obrub, veličinu i broj reči u redu menjaš sam i čuvaš kao svoj stil.',
          'Poppins, Montserrat i Anton dolaze uz program, a možeš da dodaš bilo koji TTF ili OTF font.',
        ],
      },
      {
        id: 'pauze',
        title: 'Pauze i reči',
        text: [
          'Rezzo nalazi pauze u zvuku i označi ih na vremenskoj liniji, pa vidiš šta bi bilo isečeno pre nego što se išta iseče. Pauze koje ti se sviđaju zadržiš.',
          'Reči izbacuješ isto tako: označiš ih u transkriptu i one izlaze iz klipa. Zgodno za „ovaj“ ili pogrešan početak rečenice. Epizoda ostaje netaknuta, a svaki rez se vraća jednim klikom.',
        ],
      },
      {
        id: 'slojevi',
        title: 'Slojevi i zvuk',
        text: [
          'Preko slike idu slojevi, svaki u svom redu na vremenskoj liniji: slike koje iskoče, uklize ili se uvećaju, video sa providnom pozadinom ili zelenim platnom, Lottie animacije i efekti kao što su zum, blic, promena boja i filmsko zrno.',
          'Zvuk je takođe sloj. Uz program dolazi mala biblioteka slobodnih zvučnih efekata, a možeš da koristiš i svoje fajlove i muziku. Zvuk može da prati ulaz ili izlaz nekog sloja, a muzika se sama stiša dok neko priča.',
        ],
      },
      {
        id: 'naslovna',
        title: 'Naslovna slika',
        text: [
          'Svaki klip može da dobije naslovnu: kadar iz klipa ili tvoju sliku, veliki naslov, ljude izdvojene ispred naslova i efekte. Rezzo predloži nekoliko kadrova i naslov iz transkripta, a ono što napraviš možeš da sačuvaš kao šablon.',
        ],
      },
      {
        id: 'izvoz',
        title: 'Izvoz',
        text: [
          'Izvezi pravi MP4 1080×1920, na grafičkoj kartici kad je ima, bez watermarka. Pregled i izvoz crta isti renderer, pa fajl izgleda kao ono što si gledao dok si radio.',
        ],
      },
    ],
  },

  changes: {
    title: 'Izmene po verzijama | Rezzo',
    description: 'Šta je novo u svakoj verziji Rezza, besplatnog programa za vertikalne klipove iz podkasta.',
    h1: 'Izmene',
    lead: 'Isti spisak je i u programu: klikni na broj verzije na početnom ekranu.',
    version: (v: string) => `Verzija ${v}`,
  },

  licenses: {
    title: 'Licence | Rezzo',
    description: 'Pod kojom licencom je Rezzo, šta je još u instalateru i odakle su fontovi i slike na ovom sajtu.',
    h1: 'Licence',
    appTitle: 'Rezzo',
    app: 'Rezzo je slobodan softver pod licencom GNU GPL 3.0. Možeš da ga koristiš, menjaš i deliš, a ako deliš izmenjenu verziju, deliš i njen kod pod istom licencom.',
    appLink: 'Ceo tekst licence',
    bundledTitle: 'Šta je još u instalateru',
    bundled: [
      'FFmpeg (GPL-3.0), za čitanje, sečenje i izvoz videa',
      'Electron i Chromium (MIT i drugi), na kojima program radi',
      'MediaPipe i njegovi modeli (Apache-2.0), za pronalaženje ljudi',
      'sherpa-onnx i model za glasove (Apache-2.0), za razlikovanje glasova',
      'Fontovi za titlove i interfejs (SIL Open Font License 1.1)',
      'Zvučni efekti (CC0 1.0)',
      'whisper.cpp i model za govor (MIT), koji se preuzimaju pri prvoj transkripciji',
    ],
    bundledLink: 'Tačne verzije, izvori i licence',
    siteTitle: 'Ovaj sajt',
    siteFonts: 'Fontovi Onest, Unbounded i DM Mono su pod licencom SIL Open Font License 1.1:',
    siteShots:
      'Slike ekrana prikazuju kadrove iz filma Tears of Steel, (CC) Blender Foundation | mango.blender.org, pod licencom CC BY 3.0. Transkript na njima je naš prevod engleskih titlova filma.',
    siteShotsLink: 'Odakle su slike',
    siteBuilt: 'Sajt je napravljen sa Astrom (MIT), a njegov kod je u istom repou kao program.',
  },

  notFound: {
    title: 'Strana ne postoji | Rezzo',
    description: 'Ova strana ne postoji.',
    h1: 'Ova strana ne postoji',
    text: 'Možda je adresa pogrešno ukucana, ili je strana premeštena.',
    back: 'Na početnu',
  },
};

export type Text = typeof sr;
