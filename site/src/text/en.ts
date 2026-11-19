import type { Text } from './sr.ts';

// Everything the site says in English. Same shape as sr.ts.

export const en: Text = {
  common: {
    skip: 'Skip to content',
    navLabel: 'Main navigation',
    footerNavLabel: 'Footer links',
    nav: {
      howItWorks: 'How it works',
      guide: 'Guide',
      github: 'GitHub',
      download: 'Download',
    },
    otherLang: 'Srpski',
    otherLangLabel: 'The site in Serbian',
    homeLabel: 'Rezzo, home',
    license: 'Rezzo is free software under the GPL-3.0.',
    madeBy: 'Made by',
    report: 'Report a problem',
    changes: 'Changes',
    licenses: 'Licenses',
    credit:
      'The screenshots show frames from Tears of Steel, (CC) Blender Foundation | mango.blender.org, under CC BY 3.0.',
    downloadButton: 'Download the installer',
    downloadForWindows: 'Download for Windows',
    version: (v: string) => `Version ${v}`,
    notPublished: 'coming to GitHub soon',
    megabytes: (mb: number) => `${mb.toLocaleString('en')} MB`,
    editorAlt:
      'A clip in the Rezzo editor: the transcript on the left, a vertical preview with two people stacked in the middle, and the timeline with its layers below',
    followAlt:
      'A clip in the Rezzo editor: a close-up in Follow with a caption marking the spoken word, the caption styles drawer open on the left, and the timeline with its words below',
    episodeAlt:
      'The episode screen: the video and the voices found on the left, the transcript in the middle, the clips on the right, and the whole episode in a strip along the bottom',
  },

  home: {
    title: 'Rezzo: a free app for vertical clips from podcasts',
    description:
      'Rezzo is a free, open source Windows app that turns a whole podcast episode into vertical clips with captions. No watermark, no subscription.',
    kicker: 'Free · open source · Windows',
    h1: 'A free app for clips from podcasts',
    lead: 'Rezzo writes the episode down as a transcript. You pick the sentences, and it cuts a 9:16 clip, keeps whoever is talking in frame and adds captions word by word.',
    clipAlt:
      'A drawn vertical clip: two people stacked, the frame moving closer to whoever is talking, and the caption between them appearing word by word',
    clipCaption: '1080×1920, no watermark',
    captionLines: [
      ['A', 'whole', 'episode'],
      ['into', 'vertical', 'clips'],
    ],
    noneLabel: "What Rezzo doesn't have",
    none: ['Watermark: none', 'Subscription: none', 'Paid version: none'],
    editorCaption: 'The clip editor. What you see in the preview is what ends up in the file.',
    howId: 'how-it-works',
    howTitle: 'How it works',
    steps: [
      {
        title: 'Bring in the episode',
        text: 'Press Transcribe and Rezzo writes the whole episode down, with a time for every word.',
      },
      {
        title: 'Select a few sentences',
        text: 'They become a clip. Rezzo finds the camera cuts and the people in the shot, and Auto frame picks a layout for each shot.',
      },
      {
        title: 'Finish it and export',
        text: 'Captions, pauses, pictures, sound. The export is a 1080×1920 MP4 and looks the same as the preview in the editor.',
      },
    ],
    featuresId: 'features',
    featuresTitle: 'What it does',
    features: [
      {
        title: 'Transcript',
        text: 'Always in Latin script, even when the model hands back Cyrillic. Search it while the video plays and fix words from the keyboard. A word the model always gets wrong goes on the replacement list, and you stop fixing it.',
      },
      {
        title: 'Framing',
        text: 'It follows whoever is talking, stacks two people on top of each other, or puts the whole picture over a blurred copy of itself. It\'s all ordinary keyframes, so you can change any of them by hand.',
      },
      {
        title: 'Captions',
        text: 'They appear word by word and mark the word being spoken. Set the font, colours, outline and words per line once and keep it as your own style.',
      },
      {
        title: 'Pauses',
        text: 'Rezzo finds them in the sound and shows them on the timeline before anything is cut. An "um" or a false start comes out the same way. Every cut comes back with a click.',
      },
      {
        title: 'Layers and sound',
        text: 'Images, video with a green screen, Lottie animations, effects, sound effects and music. Music gets quieter by itself while someone talks.',
      },
      {
        title: 'Cover picture',
        text: 'Every clip gets a cover: a frame from the clip or your own picture, a title, the people cut out in front of it, and templates you can reuse.',
      },
    ],
    episodeCaption: 'The episode screen: the transcript in the middle, voices on the left, clips on the right.',
    whyTitle: "Why it's free",
    why: [
      'I post podcast clips on social media, and the work is the same every time: find a good moment, crop a wide shot down to 9:16, keep whoever is talking in frame, add captions.',
      'The apps that handle this well either stamp a watermark on the video or put the useful parts behind a monthly subscription. Rezzo does the same job for free, and every feature is in the free version because there is no other version.',
    ],
    signature: 'The author',
    faqId: 'questions',
    faqTitle: 'Questions',
    faq: [
      {
        q: 'Is it really free?',
        a: "Yes. There's no paid version, no trial and no account. The code is on GitHub under the GPL-3.0, so anyone can read it and build it themselves.",
      },
      {
        q: 'Do I need an NVIDIA graphics card?',
        a: "No. With one, transcription and export are a lot faster. Without one, they run on the processor.",
      },
      {
        q: 'Does Rezzo upload my video anywhere?',
        a: 'No. The video and the transcript stay on your computer. Rezzo goes online the first time you transcribe, to download whisper.cpp and the speech model.',
      },
      {
        q: 'What language does it transcribe?',
        a: "Rezzo is made for shows in Serbian. The text is always in Latin script, even when the model hands back Cyrillic.",
      },
      {
        q: 'Does it run on a Mac or Linux?',
        a: 'Not yet. Windows only for now; macOS and Linux are on the roadmap.',
      },
      {
        q: 'Why does Windows warn me when I run the installer?',
        a: 'The installer isn\'t signed yet, so SmartScreen warns you the first time. Click "More info", then "Run anyway".',
      },
    ],
    downloadId: 'download',
    downloadTitle: 'Download Rezzo',
    downloadNotes: [
      'Windows only for now. macOS and Linux are on the roadmap.',
      "It installs for your user and doesn't need administrator rights.",
      "An NVIDIA card makes transcription and export faster, but it isn't required.",
      'The first time you transcribe, it downloads the speech model, about 1.3 GB with an NVIDIA card.',
    ],
    downloadMore: 'All about installing',
  },

  download: {
    title: 'Download Rezzo for Windows',
    description:
      'The Windows installer, what your computer needs, and how to get past the SmartScreen warning. Rezzo is free and adds no watermark.',
    h1: 'Download Rezzo',
    lead: 'One installer for Windows. No account, no trial, no paid version.',
    checksum: "The installer's SHA256 checksum is in the release on GitHub.",
    allReleases: 'All releases',
    needsTitle: 'What you need',
    needs: [
      'Windows 10 or 11, 64-bit.',
      "An NVIDIA card isn't required. With one, transcription and export are a lot faster; without one, they run on the processor.",
      'Disk space for the speech model. With an NVIDIA card it\'s about 1.3 GB.',
    ],
    installTitle: 'Installing',
    install: [
      'Download the installer and run it.',
      'Windows SmartScreen warns you the first time because the installer isn\'t signed yet. Click "More info", then "Run anyway".',
      "Rezzo installs for your user and doesn't need administrator rights.",
      'The first time you press Transcribe, Rezzo downloads whisper.cpp and the speech model into %LOCALAPPDATA%\\Rezzo.',
    ],
    removeTitle: 'Uninstalling',
    remove:
      'Uninstalling leaves the model in %LOCALAPPDATA%\\Rezzo, so a reinstall doesn\'t download it again. "Disk space" on the home screen shows what Rezzo keeps there and lets you delete it.',
    buildTitle: 'Building it yourself',
    build: 'You need Windows and Node 24. These three steps run the app from source; the README has the rest.',
    readme: 'README on GitHub',
  },

  guide: {
    title: 'Guide: from an episode to a clip | Rezzo',
    description:
      'How to make a vertical clip in Rezzo: transcript, picking sentences, framing, captions, pauses, layers, the cover and export.',
    h1: 'From an episode to a clip',
    lead: 'This is the whole way from a full episode to a finished MP4. The button names are the ones you see in the app.',
    sections: [
      {
        id: 'transcript',
        title: 'Transcript',
        text: [
          'Open an episode and press Transcribe. Rezzo writes down what is said and gives every word a time. The text is always in Latin script, even when the model hands back Cyrillic.',
          'While the video plays you can search the transcript (Ctrl+F) and fix wrong words one after another from the keyboard. Words the model gets wrong every time go in Replacements, and every new transcript has them fixed already.',
          'Rezzo tells the voices in the episode apart and colours them in the strip along the bottom. If one person ended up as two voices, merge them in the Voices card.',
        ],
        image: 'episode',
      },
      {
        id: 'clip',
        title: 'A clip from sentences',
        text: [
          'Select a few sentences in the transcript and make a clip of them. The clip opens in the editor, where Rezzo looks for camera cuts and people.',
        ],
      },
      {
        id: 'framing',
        title: 'Framing',
        text: [
          'Auto frame picks one of three layouts for each camera shot: Follow keeps whoever is talking in frame, Split stacks two people on top of each other, and Full frame puts the whole picture over a blurred copy of itself.',
          "On a wide shot Rezzo can't tell who is talking by itself. Turn on Show people and click whoever is. That one click tells it where that voice sits for the rest of the episode.",
          "Whatever Auto frame does is ordinary keyframes, so you can move or delete any of them.",
        ],
        image: 'clip',
      },
      {
        id: 'captions',
        title: 'Captions',
        text: [
          'Every clip gets captions that appear word by word and mark the word being spoken. There are a few built-in styles, and you can change the font, colours, outline, size and how many words fit on a line, then keep the result as your own style.',
          'Poppins, Montserrat and Anton come with the app, and you can add any TTF or OTF font you have.',
        ],
        image: 'follow',
      },
      {
        id: 'pauses',
        title: 'Pauses and words',
        text: [
          'Rezzo finds pauses in the sound and marks them on the timeline, so you see what would be cut before anything is. Keep the ones you like.',
          'Words come out the same way: select them in the transcript and they leave the clip. Handy for an "um" or a false start. Nothing happens to the episode itself, and a cut comes back with a click.',
        ],
      },
      {
        id: 'layers',
        title: 'Layers and sound',
        text: [
          'On top of the picture go layers, each on its own row of the timeline: images that pop, slide or zoom in, videos with a transparent background or a green screen, Lottie animations, and effects like a zoom punch, a flash, colour changes or film grain.',
          'Sound is a layer too. A small library of free sound effects comes with the app, or use your own files and music. A sound can go with a layer coming in or going out, and music gets quieter by itself while someone talks.',
        ],
      },
      {
        id: 'cover',
        title: 'Cover picture',
        text: [
          'Each clip can have a cover: a frame from the clip or your own picture, a big title, the people cut out in front of it, and effects. Rezzo suggests a few frames and a title from the transcript, and you can keep what you made as a template.',
        ],
      },
      {
        id: 'export',
        title: 'Export',
        text: [
          'Export makes a 1080×1920 MP4, on the graphics card when there is one, with no watermark. The preview and the export use the same renderer, so the file looks like what you saw while editing.',
        ],
      },
    ],
  },

  changes: {
    title: 'Changes by version | Rezzo',
    description: 'What is new in each version of Rezzo, the free app for vertical clips from podcasts.',
    h1: 'Changes',
    lead: 'The same list is in the app: click the version number on the home screen.',
    version: (v: string) => `Version ${v}`,
  },

  licenses: {
    title: 'Licenses | Rezzo',
    description: "Rezzo's license, what else is in the installer, and where this site's fonts and pictures come from.",
    h1: 'Licenses',
    appTitle: 'Rezzo',
    app: 'Rezzo is free software under the GNU GPL 3.0. You can use it, change it and share it, and if you share a changed version, you share its code under the same license.',
    appLink: 'The full license text',
    bundledTitle: 'What else is in the installer',
    bundled: [
      'FFmpeg (GPL-3.0), to read, cut and export video',
      'Electron and Chromium (MIT and others), which the app runs on',
      'MediaPipe and its models (Apache-2.0), to find people',
      'sherpa-onnx and a voice model (Apache-2.0), to tell voices apart',
      'Fonts for captions and the interface (SIL Open Font License 1.1)',
      'Sound effects (CC0 1.0)',
      'whisper.cpp and the speech model (MIT), downloaded the first time you transcribe',
    ],
    bundledLink: 'Exact versions, sources and licenses',
    siteTitle: 'This site',
    siteFonts: 'The fonts Onest, Unbounded and DM Mono are under the SIL Open Font License 1.1:',
    siteShots:
      'The screenshots show frames from Tears of Steel, (CC) Blender Foundation | mango.blender.org, under CC BY 3.0. The transcript in them is our translation of the film\'s English subtitles.',
    siteShotsLink: 'Where the screenshots come from',
    siteBuilt: 'The site is made with Astro (MIT), and its code is in the same repository as the app.',
  },

  notFound: {
    title: 'Page not found | Rezzo',
    description: "This page doesn't exist.",
    kicker: 'Error 404',
    h1: 'This page got cut',
    text: 'The address may be mistyped, or the page has moved. Like every cut in Rezzo, this one comes back with a click.',
    back: 'Go to the home page',
  },
};
