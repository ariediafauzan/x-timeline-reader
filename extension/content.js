(() => {
  const TTS_SERVER = "http://localhost:8787";
  const MAX_TWEET_LENGTH = 600;

  const state = {
    playing: false,
    paused: false,
    rate: 1.0,
    readQueue: [],
    readTweetIds: new Set(),
    currentAudio: null,
    filter: "",
    currentArticle: null,
    tweetIndex: 0,
    serverReady: false,
    speaker: "Andrew",
    readQuotes: true,
    readLongTweets: false,
    speaking: false,
  };

  const INTROS = [
    (a) => `Here's ${a} with an interesting take.`,
    (a) => `${a} just posted this.`,
    (a) => `Let's hear from ${a}.`,
    (a) => `Ooh, ${a} has something to say.`,
    (a) => `Next up, ${a} writes.`,
    (a) => `Moving on. ${a} says.`,
    (a) => `Now, ${a} dropped this.`,
    (a) => `Check this out from ${a}.`,
    (a) => `Over to ${a}.`,
    (a) => `Alright, ${a} posted.`,
    (a) => `${a} chiming in.`,
    (a) => `And ${a} adds.`,
    (a) => `Hot take incoming from ${a}.`,
    (a) => `${a} weighs in.`,
  ];

  const TRANSITIONS = [
    "Alright, next one.",
    "Moving along.",
    "Let's keep going.",
    "Okay, what else we got.",
    "Next.",
    "Scrolling down.",
    "",
    "",
    "",
  ];

  let lastIntroIndex = -1;

  function pickRandom(arr) {
    let idx;
    do {
      idx = Math.floor(Math.random() * arr.length);
    } while (idx === lastIntroIndex && arr.length > 1);
    lastIntroIndex = idx;
    return arr[idx];
  }

  async function checkServer() {
    try {
      const resp = await fetch(`${TTS_SERVER}/health`);
      const data = await resp.json();
      state.serverReady = data.status === "ready";
      return state.serverReady;
    } catch {
      state.serverReady = false;
      return false;
    }
  }

  function matchesFilter(text) {
    if (!state.filter) return true;
    const keywords = state.filter.toLowerCase().split(",").map((k) => k.trim()).filter(Boolean);
    if (keywords.length === 0) return true;
    const lower = text.toLowerCase();
    return keywords.some((kw) => lower.includes(kw));
  }

  function isAd(article) {
    // Ads have a "Ad" label or are marked as promoted
    const adIndicators = article.querySelectorAll('span');
    for (const span of adIndicators) {
      const text = span.innerText.trim();
      if (text === 'Ad' || text === 'Promoted' || text === 'Paid partnership') return true;
    }
    // Ads also have a specific SVG path or "adBadge" test ID
    if (article.querySelector('[data-testid="placementTracking"]')) return true;
    // Check for "Promoted" in the article's accessible description
    const promotedEl = article.querySelector('div[dir] > span');
    if (promotedEl) {
      const walk = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      while (walk.nextNode()) {
        if (walk.currentNode.textContent.trim() === 'Ad') {
          // Verify it's the ad badge, not just the word "ad" in tweet text
          const parent = walk.currentNode.parentElement;
          if (parent && parent.closest('[data-testid="User-Name"]')) return true;
        }
      }
    }
    return false;
  }

  function hasVideo(article) {
    // Check for video player, video element, or the play button overlay
    if (article.querySelector('video')) return true;
    if (article.querySelector('[data-testid="videoPlayer"]')) return true;
    if (article.querySelector('[data-testid="videoComponent"]')) return true;
    if (article.querySelector('div[role="progressbar"][aria-label]')) return true;
    return false;
  }

  function isQuoteTweet(article) {
    // Quoted tweets have a nested article or a specific quote container
    const quoteContainer = article.querySelector('[data-testid="quoteTweet"]') ||
      article.querySelector('div[role="link"][tabindex="0"] article');
    return !!quoteContainer;
  }

  function isLongTweet(text) {
    return text.length > MAX_TWEET_LENGTH;
  }

  function extractTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const tweets = [];

    for (const article of articles) {
      // Skip ads
      if (isAd(article)) {
        console.log("[X Reader] Skipped ad");
        continue;
      }

      // Skip video tweets
      if (hasVideo(article)) {
        console.log("[X Reader] Skipped video tweet");
        continue;
      }

      const textEl = article.querySelector('div[data-testid="tweetText"]');
      if (!textEl) continue;

      let text = textEl.innerText.trim();
      if (!text) continue;

      // Handle quote tweets
      if (isQuoteTweet(article)) {
        if (!state.readQuotes) {
          console.log("[X Reader] Skipped quote tweet");
          continue;
        }
        // Get the quoted tweet text too
        const quoteEl = article.querySelector('[data-testid="quoteTweet"] div[data-testid="tweetText"]') ||
          article.querySelector('div[role="link"][tabindex="0"] div[data-testid="tweetText"]');
        if (quoteEl) {
          const quoteText = quoteEl.innerText.trim();
          // The main tweetText may include the quote — deduplicate
          if (!text.includes(quoteText)) {
            text = `${text} ... quoting: ${quoteText}`;
          }
        }
      }

      // Handle long tweets
      if (isLongTweet(text) && !state.readLongTweets) {
        // Truncate to a reasonable length
        text = text.slice(0, MAX_TWEET_LENGTH) + "... and so on.";
      }

      if (!matchesFilter(text)) continue;

      let author = "Someone";
      const userNameEl =
        article.querySelector('div[data-testid="User-Name"] a[role="link"] span') ||
        article.querySelector('div[data-testid="User-Name"] span');
      if (userNameEl) {
        author = userNameEl.innerText.trim();
      }

      const id = `${author}::${text.slice(0, 80)}`;
      if (state.readTweetIds.has(id)) continue;

      tweets.push({ id, author, text, article });
    }

    console.log("[X Reader] Extracted", tweets.length, "tweets");
    return tweets;
  }

  function highlightTweet(article) {
    if (state.currentArticle) {
      state.currentArticle.style.outline = "";
      state.currentArticle.style.outlineOffset = "";
    }
    if (article) {
      article.scrollIntoView({ behavior: "smooth", block: "center" });
      article.style.outline = "2px solid #1d9bf0";
      article.style.outlineOffset = "4px";
      state.currentArticle = article;
    }
  }

  function clickShowMore() {
    // "Show more" / "Show N posts" buttons in the timeline
    const candidates = document.querySelectorAll(
      '[role="button"], [data-testid="cellInnerDiv"] span'
    );
    for (const el of candidates) {
      const txt = el.innerText.trim().toLowerCase();
      if (
        txt === 'show more' ||
        txt.match(/^show \d+ posts?$/) ||
        txt === 'see new posts' ||
        txt.match(/^show \d+ more repl/)
      ) {
        console.log("[X Reader] Clicking:", el.innerText.trim());
        el.click();
        return true;
      }
    }
    return false;
  }

  function speakServer(text) {
    return new Promise(async (resolve) => {
      if (!text) { resolve(); return; }
      try {
        const resp = await fetch(`${TTS_SERVER}/speak`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, speaker: state.speaker, rate: state.rate }),
        });
        if (!resp.ok) { resolve(); return; }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        state.currentAudio = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          state.currentAudio = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          state.currentAudio = null;
          resolve();
        };
        audio.play();
      } catch {
        resolve();
      }
    });
  }

  function speakBrowser(text) {
    return new Promise((resolve) => {
      if (!text) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.rate = state.rate;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }

  async function speakText(text) {
    if (state.serverReady) {
      await speakServer(text);
    } else {
      await speakBrowser(text);
    }
  }

  function prebufferUpcoming() {
    // Send next few tweets to server for background generation
    if (!state.serverReady || state.readQueue.length === 0) return;
    const upcoming = state.readQueue.slice(0, 3).map((t) => {
      const intro = INTROS[0](t.author); // use consistent intro for cache key
      return `${intro} ... ${t.text}`;
    });
    try {
      fetch(`${TTS_SERVER}/prebuffer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: upcoming, speaker: state.speaker, rate: state.rate }),
      });
    } catch {}
  }

  async function speakNext() {
    if (!state.playing || state.paused) return;
    if (state.speaking) return;
    state.speaking = true;

    if (state.readQueue.length === 0) {
      // Try clicking "Show more" / "Show N posts" first
      clickShowMore();
      await new Promise((r) => setTimeout(r, 1500));

      const newTweets = extractTweets();
      if (newTweets.length === 0) {
        window.scrollBy({ top: 600, behavior: "smooth" });
        await new Promise((r) => setTimeout(r, 2500));
        clickShowMore();
        await new Promise((r) => setTimeout(r, 1500));
        if (!state.playing || state.paused) { state.speaking = false; return; }
        const retry = extractTweets();
        if (retry.length === 0) {
          window.scrollBy({ top: 600, behavior: "smooth" });
          await new Promise((r) => setTimeout(r, 2500));
          const last = extractTweets();
          if (last.length === 0) {
            await speakText("No more tweets right now. Checking again shortly.");
            await new Promise((r) => setTimeout(r, 5000));
            state.speaking = false;
            speakNext();
            return;
          }
          state.readQueue.push(...last);
        } else {
          state.readQueue.push(...retry);
        }
      } else {
        state.readQueue.push(...newTweets);
      }
    }

    // Pre-buffer upcoming tweets while we speak the current one
    prebufferUpcoming();

    if (!state.playing || state.paused) { state.speaking = false; return; }

    const tweet = state.readQueue.shift();
    state.readTweetIds.add(tweet.id);
    state.tweetIndex++;

    highlightTweet(tweet.article);
    await new Promise((r) => setTimeout(r, 600));
    if (!state.playing || state.paused) { state.speaking = false; return; }

    if (state.tweetIndex > 1) {
      const transition = pickRandom(TRANSITIONS);
      if (transition) {
        await speakText(transition);
        if (!state.playing || state.paused) { state.speaking = false; return; }
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    const intro = pickRandom(INTROS)(tweet.author);
    const fullText = `${intro} ... ${tweet.text}`;

    console.log("[X Reader] Speaking:", tweet.author, "-", tweet.text.slice(0, 60));
    notifyPopup({ type: "now-reading", author: tweet.author, text: tweet.text });

    await speakText(fullText);
    if (!state.playing || state.paused) { state.speaking = false; return; }

    state.currentAudio = null;
    await new Promise((r) => setTimeout(r, 500));
    state.speaking = false;
    speakNext();
  }

  async function startReading() {
    if (state.playing && !state.paused) return;

    if (state.paused) {
      state.paused = false;
      if (state.currentAudio) state.currentAudio.play();
      notifyPopup({ type: "state", playing: true, paused: false });
      return;
    }

    await checkServer();

    state.playing = true;
    state.paused = false;
    state.tweetIndex = 0;
    state.readQueue = extractTweets();

    notifyPopup({
      type: "state",
      playing: true,
      paused: false,
      engine: state.serverReady ? "qwen" : "browser",
    });

    const filterNote = state.filter
      ? `Alright, let's check out what people are saying about ${state.filter}.`
      : "Let's see what's on your timeline.";
    await speakText(filterNote);
    speakNext();
  }

  function pauseReading() {
    if (!state.playing) return;
    state.paused = true;
    if (state.currentAudio) state.currentAudio.pause();
    speechSynthesis.pause();
    notifyPopup({ type: "state", playing: true, paused: true });
  }

  function stopReading() {
    state.playing = false;
    state.paused = false;
    state.speaking = false;
    state.readQueue = [];
    state.tweetIndex = 0;
    if (state.currentAudio) { state.currentAudio.pause(); state.currentAudio = null; }
    speechSynthesis.cancel();
    highlightTweet(null);
    notifyPopup({ type: "state", playing: false, paused: false });
    notifyPopup({ type: "now-reading", author: "", text: "" });
  }

  function skipTweet() {
    if (state.currentAudio) { state.currentAudio.pause(); state.currentAudio = null; }
    speechSynthesis.cancel();
    state.speaking = false;
    setTimeout(speakNext, 100);
  }

  function notifyPopup(msg) {
    try { chrome.runtime.sendMessage(msg); } catch {}
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case "start":
        startReading(); sendResponse({ ok: true }); break;
      case "pause":
        pauseReading(); sendResponse({ ok: true }); break;
      case "stop":
        stopReading(); sendResponse({ ok: true }); break;
      case "skip":
        skipTweet(); sendResponse({ ok: true }); break;
      case "setRate":
        state.rate = msg.rate; sendResponse({ ok: true }); break;
      case "setFilter":
        state.filter = msg.filter;
        if (state.playing) state.readQueue = extractTweets();
        sendResponse({ ok: true }); break;
      case "setSpeaker":
        state.speaker = msg.speaker; sendResponse({ ok: true }); break;
      case "setOptions":
        if (msg.readQuotes !== undefined) state.readQuotes = msg.readQuotes;
        if (msg.readLongTweets !== undefined) state.readLongTweets = msg.readLongTweets;
        sendResponse({ ok: true }); break;
      case "getState":
        sendResponse({
          playing: state.playing,
          paused: state.paused,
          rate: state.rate,
          filter: state.filter,
          speaker: state.speaker,
          readQuotes: state.readQuotes,
          readLongTweets: state.readLongTweets,
          queueLength: state.readQueue.length,
          engine: state.serverReady ? "qwen" : "browser",
        }); break;
      case "checkServer":
        checkServer().then((ready) => sendResponse({ ready }));
        return true;
      default:
        sendResponse({ ok: false });
    }
    return true;
  });

  checkServer().then((ready) => {
    console.log("[X Reader] Loaded.", ready ? "Edge TTS connected." : "TTS server not found.");
  });
})();
