const CONFIG = {
    BASE_URL: 'https://alex-papineau.github.io/amazon-smt-music-companion/music/',
    TRACKS: [
        { id: 'dds1_junk_yard', name: 'Digital Devil Saga: Junk Yard', filename: 'dds1_junk_yard.webm' },
        { id: 'ds2_special_auction', name: 'Devil Survivor 2: Special Auction', filename: 'ds2_special_auction.webm' },
        { id: 'ds_hagurumadou', name: 'Devil Summoner: Hagurumadou', filename: 'ds_hagurumadou.webm' },
        { id: 'ds_yaraiginza', name: 'Devil Summoner: Yaraiginza Shopping Arcade', filename: 'ds_yaraiginza.webm' },
        { id: 'dx2_shop', name: 'SMT Liberation Dx2: Shop', filename: 'dx2_shop.webm' },
        { id: 'imagine_nakano_field', name: 'SMT Imagine: Nakano Field', filename: 'imagine_nakano_field.webm' },
        { id: 'kms_shop', name: 'Kyuuyaku Megami Tensei: Shop', filename: 'kms_shop.webm' },
        { id: 'maken_istanbul', name: 'Maken Shao: Istanbul', filename: 'maken_istanbul.webm' },
        { id: 'mt2_in_the_shop', name: 'Majin Tensei 2: In The Shop', filename: 'mt2_in_the_shop.webm' },
        { id: 'mt2_ladys_shop', name: 'Megami Tensei 2: Lady\'s Shop', filename: 'mt2_ladys_shop.webm' },
        { id: 'mt_shop_rag', name: 'Majin Tensei: Rag\'s Shop', filename: 'mt_shop_rag.webm' },
        { id: 'p1_black_market', name: 'Persona 1: Black Market', filename: 'p1_black_market.webm' },
        { id: 'p1_satomi_tadashi', name: 'Persona 1: Satomi Tadashi Pharmacy', filename: 'p1_satomi_tadashi.webm' },
        { id: 'p2ep_baofu', name: 'Persona 2 EP: Baofu', filename: 'p2ep_baofu.webm' },
        { id: 'p2is_tonys_shop', name: 'Persona 2 IS: Tony\'s Shop', filename: 'p2is_tonys_shop.webm' },
        { id: 'p3_tanaka', name: 'Persona 3: Tanaka\'s Amazing Commodities', filename: 'p3_tanakas_amazing_commodities.webm' },
        { id: 'raidou_konnouya', name: 'Raidou Kuzunoha: Konnou-ya', filename: 'raidou_konnouya.webm' },
        { id: 'ronde_bar', name: 'Ronde: Bar', filename: 'ronde_bar.webm' },
        { id: 'sh_akane_mall', name: 'Soul Hackers: Akane Mall', filename: 'sh_akane_mall.webm' },
        { id: 'smt1_shop', name: 'SMT I: Shop', filename: 'smt1_shop.webm' },
        { id: 'smt2_shop', name: 'SMT II: Shop', filename: 'smt2_shop.webm' },
        { id: 'smt3_junk_shop', name: 'SMT III: Junk Shop', filename: 'smt3_junk_shop.webm' },
        { id: 'smt4_ashurakai_shop', name: 'SMT IV: Ashura-Kai Authorized Shop', filename: 'smt4_ashurakai_shop.webm' },
        { id: 'smt4_black_market', name: 'SMT IV: Black Market', filename: 'smt4_black_market.webm' },
        { id: 'smt4_shop', name: 'SMT IV: Shop', filename: 'smt4_shop.webm' },
        { id: 'smt4f_kinshicho_underground', name: 'SMT IV Apocalypse: Kinshicho Underground', filename: 'smt4f_kinshicho_underground.webm' },
        { id: 'smt5_cadavers_hollow', name: 'SMT V: Cadaver\'s Hollow', filename: 'smt5_cadavers_hollow.webm' },
        { id: 'smt9_shop', name: 'SMT NINE: Shop', filename: 'smt9_shop.webm' },
        { id: 'smtif_shopping_arcade', name: 'SMT if...: Shopping Arcade', filename: 'smtif_shopping_arcade.webm' },
        { id: 'synchro_shopping_mall', name: 'SMT Synchronicity: Shopping Mall', filename: 'synchro_shopping_mall.webm' }
    ],
    DEFAULT_TRACK_INDEX: 0
};

// Helper to get full URL for a track
function getTrackUrl(trackFilename) {
    if (!trackFilename) return '';
    if (trackFilename.startsWith('http://') || trackFilename.startsWith('https://')) {
        return trackFilename;
    }
    return CONFIG.BASE_URL + trackFilename;
}

// Get default track URL
function getDefaultTrackUrl() {
    return getTrackUrl(CONFIG.TRACKS[CONFIG.DEFAULT_TRACK_INDEX].filename);
}

// Pick a random track from the list, optionally excluding one
function getRandomTrackUrl(excludeTrackUrl) {
    if (CONFIG.TRACKS.length <= 1) {
        return getTrackUrl(CONFIG.TRACKS[0].filename);
    }

    let randomIndex;
    let newTrackUrl;
    do {
        randomIndex = Math.floor(Math.random() * CONFIG.TRACKS.length);
        newTrackUrl = getTrackUrl(CONFIG.TRACKS[randomIndex].filename);
    } while (newTrackUrl === excludeTrackUrl);

    return newTrackUrl;
}

// Generate a full Fisher-Yates shuffled list of all track URLs
function getShuffledTrackUrls() {
    const urls = CONFIG.TRACKS.map(t => getTrackUrl(t.filename));
    for (let i = urls.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [urls[i], urls[j]] = [urls[j], urls[i]];
    }
    return urls;
}

// Advance to the next track in the queue, replenishing the deck when empty
function getNextTrackUrl(currentUrl, queue = []) {
    let remainingQueue = (queue || []).filter(url => url !== currentUrl);
    if (remainingQueue.length === 0) {
        remainingQueue = getShuffledTrackUrls().filter(url => url !== currentUrl);
    }
    const nextTrack = remainingQueue.shift();
    return { nextTrack, remainingQueue };
}

