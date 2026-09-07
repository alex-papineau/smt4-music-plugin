const assert = require('assert');
const fs = require('fs');

// Load config.js and export symbols
const code = fs.readFileSync('config.js', 'utf8');
const { CONFIG, getShuffledTrackUrls, getNextTrackUrl, getTrackUrl } = new Function(code + '; return { CONFIG, getShuffledTrackUrls, getNextTrackUrl, getTrackUrl };')();




// Test 1: getShuffledTrackUrls returns all tracks without duplicates
const deck = getShuffledTrackUrls();
assert.strictEqual(deck.length, CONFIG.TRACKS.length, "Deck must contain all tracks");
assert.strictEqual(new Set(deck).size, CONFIG.TRACKS.length, "Deck must not contain duplicates");

// Test 2: getNextTrackUrl exhausts deck before repeating
const queue = [...deck];
const played = [];
while (queue.length > 0) {
    const { nextTrack, remainingQueue } = getNextTrackUrl(played[played.length - 1], queue);
    played.push(nextTrack);
    queue.length = 0;
    queue.push(...remainingQueue);
}
assert.strictEqual(played.length, CONFIG.TRACKS.length, "Must play all tracks from queue");
assert.strictEqual(new Set(played).size, CONFIG.TRACKS.length, "No duplicates while queue not exhausted");

// Test 3: getNextTrackUrl automatically replenishes queue when exhausted
const replenished = getNextTrackUrl(played[played.length - 1], []);
assert.ok(replenished.nextTrack, "Should return next track when queue was empty");
assert.strictEqual(replenished.remainingQueue.length, CONFIG.TRACKS.length - 2, "Remaining queue should have tracks - 2 (1 excluded current, 1 popped next)");
assert.notStrictEqual(replenished.nextTrack, played[played.length - 1], "Should not repeat current track when replenished");


console.log("All shuffle tests passed!");
