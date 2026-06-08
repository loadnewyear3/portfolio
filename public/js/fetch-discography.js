// This script fetches the discography of a specified artist from MusicBrainz,
// including cover art from the Cover Art Archive, and saves it to a JSON file. 

// Do not edit this part below as it sets up the script environment.
const fs = require('fs');
const path = require('path');
const https = require('https');

// =================================================================================
// --- CONFIGURATION ---
// =================================================================================
// This script reads its configuration from a `discography.config.json` file
// located in the root of your Hugo project.
// ---------------------------------------------------------------------------------

/**
 * Searches for the project root by looking for a sentinel file (e.g., 'discography.config.json')
 * starting from a given directory and moving upwards.
 * @param {string} startPath The path to start searching from.
 * @returns {string|null} The path to the project root, or null if not found.
 */
function findProjectRoot(startPath) {
  let currentPath = startPath;
  const sentinelFile = 'discography.config.json';
  // Loop until we hit the filesystem root
  while (currentPath !== path.parse(currentPath).root) {
    if (fs.existsSync(path.join(currentPath, sentinelFile))) {
      return currentPath;
    }
    currentPath = path.dirname(currentPath);
  }
  return null;
}

let ARTIST_ID, USER_AGENT, RELEASE_TYPES, projectRoot;

try {
  // Make the script more robust by intelligently finding the project root.
  projectRoot = findProjectRoot(__dirname);
  if (!projectRoot) {
    throw new Error(`Could not find 'discography.config.json'. Make sure it's in your project root.`);
  }

  const configPath = path.join(projectRoot, 'discography.config.json');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configContent);

  if (!config || !config.artist_id || !config.user_agent) {
    throw new Error('`artist_id` and `user_agent` are missing from discography.config.json');
  }
  ARTIST_ID = config.artist_id;
  USER_AGENT = config.user_agent;
  RELEASE_TYPES = config.release_types || 'album|ep|single'; // Default value
} catch (error) {
  console.error(`❌ FATAL: Could not find or parse configuration file.`);
  console.error(`   > Error details: ${error.message}`);
  process.exit(1); // Exit the script if config is missing or invalid
}

// It is possible to use cron jobs or other scheduling methods to run this script periodically.
// To ensure your website does not abuse the MusicBrainz API, it best to set this to run once a week.
// This is due to some edits need to voted on before they are applied and this can take 1 week.


// The path to a placeholder image for releases that do not have cover art.
// This path should be relative to the root of your website.
const PLACEHOLDER_IMG = '/images/placeholders/no-cover-art.jpg';

// =================================================================================
// --- DONATE TO MUSICBRAINZ AND INTERNET ARCHIVE ---
// =================================================================================
// If this script helps you, please consider supporting Metabrainz,
// the team behind Musicbrainz and Archive.org for hosting the cover art,
// with a donation: at https://metabrainz.org/donate and https://archive.org/donate
// ---------------------------------------------------------------------------------

// --- SCRIPT LOGIC ---
// Do not edit below this line unless you know what you are doing.
// =================================================================================

// --- Constants & Setup ---
const API_LIMIT = 5; // Max number of items to request per page from the API.
const COVER_ART_BASE_URL = 'https://coverartarchive.org/release-group/';
const DATA_DIR = path.resolve(projectRoot, 'data');
const OUT_FILE = path.join(DATA_DIR, 'discography.json');
const BASE_DELAY_MS = 60000; // Base delay in miliseconds
let requestSequence = 0;
const MAX_RETRIES = 50; // Increased retries for more resilience
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * A generic function to fetch JSON data from a URL.
 * @param {string} url The URL to fetch.
 * @returns {Promise<object>} A promise that resolves with the parsed JSON data.
 */
function fetchData(url) {
  const options = { headers: { 'User-Agent': USER_AGENT } };

  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
      // Handle redirects (e.g., 307 Temporary Redirect)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // The location header can be a relative path, so we resolve it against the original URL's origin.
        const redirectUrl = new URL(res.headers.location, url).href;
        // Recursively call fetchData with the new URL
        fetchData(redirectUrl).then(resolve).catch(reject);
        return;
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        // For cover art, a 404 is expected and handled, so we don't reject it here.
        if (res.statusCode === 404 && url.includes('coverartarchive.org')) {
          return resolve(null); // Resolve with null to indicate no cover art found.
        }
        return reject(new Error(`Request failed with status code: ${res.statusCode} for URL: ${url}`));
      }

      let rawData = '';
      res.on('data', (chunk) => rawData += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(rawData));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
    }).on('error', (e) => {
      reject(new Error(`HTTPS request error for ${url}: ${e.message}`));
    });
  });
}

/**
 * A generic function to fetch JSON data from a URL with retry logic for 503 errors.
 * @param {string} url The URL to fetch.
 * @param {number} retries The current retry attempt (internal use).
 * @returns {Promise<object>} A promise that resolves with the parsed JSON data.
 */
async function fetchDataWithRetry(url, retries = 0) {
  try {
    return await fetchData(url);
  } catch (error) {
    // Check if it's a 503 error or a network error (ECONNRESET, ETIMEDOUT) and we have retries left
    if ((error.message.includes('status code: 503') || error.message.includes('ECONNRESET') || error.message.includes('ETIMEDOUT')) && retries < MAX_RETRIES) {
      const delayTime = Math.pow(2, retries) * 1000 + Math.random() * 500; // Exponential backoff + jitter
      console.warn(`⚠️ Received error (${error.message}) for ${url}. Retrying in ${delayTime / 1000}s... (Attempt ${retries + 1}/${MAX_RETRIES})`);
      await delay(delayTime);
      return fetchDataWithRetry(url, retries + 1);
    } else if (error.message.includes('status code: 404') && url.includes('coverartarchive.org')) {
        // Specific handling for 404 on cover art, as it's not a critical failure
        return null;
    }
    // For other errors or max retries reached, re-throw the error
    throw error;
  }
}

/**
 * Fetches the front cover art URL for a given MusicBrainz release group ID.
 * @param {string} releaseGroupId The MBID of the release group.
 * @returns {Promise<string>} A promise that resolves with the cover art URL or a placeholder.
 */
async function getCoverArtUrl(releaseGroupId) {
  const url = `${COVER_ART_BASE_URL}${releaseGroupId}`;
  try { // Use fetchDataWithRetry for cover art as well
    const coverArtData = await fetchDataWithRetry(url);
    // Find the image marked as "front"
    const frontImage = coverArtData?.images?.find(img => img.front);
    // Prefer the 500px thumbnail for better web performance, but fall back gracefully.
    // 1. Try for the 'large' thumbnail (500px).
    // 2. If not found, try for the full-size 'image'.
    // 3. If neither is found, use the placeholder.
    return frontImage?.thumbnails?.large || frontImage?.image || PLACEHOLDER_IMG;
  } catch (error) {
    console.warn(`ℹ️ Could not fetch or process cover art for ${releaseGroupId}. Using placeholder. Error: ${error.message}`);
    return PLACEHOLDER_IMG;
  }
}

/**
 * Converts a string into a URL-friendly slug.
 * @param {string} text The input string.
 * @returns {string} The slugified string.
 */
function slugify(text) {
  return text.toString().toLowerCase()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w-]+/g, '')       // Remove all non-word chars
    .replace(/--+/g, '-')          // Replace multiple - with single -
    .replace(/^-+/, '')            // Trim - from start of text
    .replace(/-+$/, '');           // Trim - from end of text
}

/**
 * Helper to extract the root domain for deduplication purposes.
 * Handles common TLDs like .co.uk, .com.au.
 * @param {string} url The URL to parse.
 * @returns {string} The root domain (e.g., "example.com", "example.co.uk") or the full URL if parsing fails.
 */
function getRootDomain(url) {
  try {
    const hostname = new URL(url).hostname;
    const parts = hostname.split('.');
    // Handle common multi-part TLDs (e.g., .co.uk, .com.au, .org.uk)
    if (parts.length > 2 && ['co', 'com', 'org', 'net', 'gov', 'edu', 'ac'].includes(parts[parts.length - 2])) {
      return parts.slice(-3).join('.'); // e.g., example.co.uk
    }
    return parts.slice(-2).join('.'); // e.g., example.com
  } catch (e) {
    console.warn(`Could not parse hostname for URL: ${url}. Using full URL as fallback for deduplication.`);
    return url; // Fallback if URL is malformed
  }
}

/**
 * Wrapper for fetchData to include a delay for MusicBrainz API calls.
 * @param {string} url The URL to fetch.
 * @returns {Promise<object>} A promise that resolves with the parsed JSON data.
 */
async function politeFetchData(url) {
  const waitTime = requestSequence * BASE_DELAY_MS;
  if (waitTime > 0) {
    console.log(`⏳ Request #${requestSequence + 1}: Waiting ${waitTime / 60000} minute(s) before fetching...`);
    await delay(waitTime);
  }
  requestSequence++;
  return fetchDataWithRetry(url);
}

/**
 * Parses the relations array from a MusicBrainz release group to extract streaming/purchase links.
 * It deduplicates links by URL and assigns a platform name, prioritizing 'Buy' for purchase links.
 * @param {Array} relations - The relations array from the API response.
 * @returns {Array<{url: string, platform: string}>} An array of unique link objects, sorted by platform name.
 */
function parseLinks(relations) {
  if (!relations) return [];

  // Map to store unique links, using a deduplication key
  // Key: "Platform_RootDomain" (e.g., "Amazon Music_amazon.co.uk")
  // Value: {url: string, platform: string}
  const uniqueLinksMap = new Map();

  for (const rel of relations) {
    if (rel.url?.resource) {
      const url = rel.url.resource;

      // Exclude last.fm links as they are for information/social listening, not buying/streaming
      if (url.includes('last.fm')) {
        continue; // Skip to the next relation
      }

      let platform = 'Link'; // Default generic label
      const isPurchaseRelation = ['purchase for download', 'download for free'].includes(rel.type);

      // 1. Determine the specific platform based on URL (alphabetical order for readability)
      if (url.includes('amazon.')) platform = 'Amazon Music';
      else if (url.includes('music.apple.com') || url.includes('itunes.apple.com')) platform = 'Apple Music';
      else if (url.includes('anghami.com')) platform = 'Anghami';
      else if (url.includes('archive.org')) platform = 'Archive.org'; // More general check for any archive.org link
      else if (url.includes('audius.co')) platform = 'Audius';
      else if (url.includes('bandcamp.com')) platform = 'Bandcamp'; // Covers all Bandcamp subdomains
      else if (url.includes('beatport.com')) platform = 'Beatport';
      else if (url.includes('bleep.com')) platform = 'Bleep';
      else if (url.includes('deezer.com')) platform = 'Deezer';
      else if (url.includes('discogs.com')) platform = 'Discogs';
      else if (url.includes('junodownload.co.uk')) platform = 'Juno Download';
      else if (url.includes('mega.nz')) platform = 'Mega';
      else if (url.includes('mediafire.com')) platform = 'Mediafire';
      else if (url.includes('mixcloud.com')) platform = 'Mixcloud';
      else if (url.includes('napster.com')) platform = 'Napster';
      else if (url.includes('qobuz.com')) platform = 'Qobuz';
      else if (url.includes('soundcloud.com')) platform = 'SoundCloud';
      else if (url.includes('spotify.com')) platform = 'Spotify';
      else if (url.includes('tidal.com')) platform = 'Tidal';
      else if (url.includes('traxsource.com')) platform = 'Traxsource';
      else if (url.includes('vimeo.com')) platform = 'Vimeo';
      else if (url.includes('youtube.com') || url.includes('youtu.be')) platform = 'YouTube';
      // Add more specific platforms here if needed before the generic 'Link'

      // 2. Determine the final platform label and deduplication key
      let finalPlatformLabel = platform;
      let dedupeKey;

      // If it's a purchase relation AND the platform is NOT one of the specific platforms
      // that are inherently purchase-oriented (like Bandcamp, Beatport, etc.)
      if (isPurchaseRelation && !['Anghami', 'Apple Music', 'Archive.org', 'Bandcamp', 'Beatport', 'Juno Download', 'Mediafire', 'Mega', 'Napster', 'Traxsource'].includes(platform)) {
          finalPlatformLabel = 'Buy';
          // For generic 'Buy' links, the dedupe key should be generic too,
          // but still tied to the root domain to distinguish different stores.
          dedupeKey = `Buy_${getRootDomain(url)}`;
      } else {
          // For all other cases (non-purchase, or purchase on specific platforms),
          // the dedupe key is based on the specific platform and its root domain.
          dedupeKey = `${platform}_${getRootDomain(url)}`;
      }

      // 3. Store or update the link in the map
      // We only add the link if the dedupeKey is new. If it exists, we keep the first one found.
      if (!uniqueLinksMap.has(dedupeKey)) {
        uniqueLinksMap.set(dedupeKey, { url: url, platform: finalPlatformLabel });
      }
    }
  }

  // Convert map values to array and sort alphabetically by platform name
  const sortedLinks = Array.from(uniqueLinksMap.values())
    .sort((a, b) => a.platform.localeCompare(b.platform));

  return sortedLinks;
}

/**
 * Formats a duration in milliseconds to M:SS format.
 * @param {number} ms Duration in milliseconds.
 * @returns {string} Formatted string (e.g., "3:45").
 */
function formatDuration(ms) {
  if (!ms) return '';
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return minutes + ":" + (seconds < 10 ? '0' : '') + seconds;
}

/**
 * Formats artist credits into a string.
 * @param {Array} artistCredit The artist-credit array from MusicBrainz.
 * @returns {string|null} Formatted string (e.g., "feat. Artist X") or null.
 */
function getArtistCreditString(artistCredit) {
  if (!artistCredit || !Array.isArray(artistCredit)) return null;
  return artistCredit.reduce((acc, c) => acc + c.name + (c.joinphrase || ''), '');
}

/**
 * Formats relations (credits) into a string.
 * @param {Array} relations The relations array from MusicBrainz (Release or Recording).
 * @returns {string|null} Formatted string (e.g., "Remix by Artist X") or null.
 */
function getCreditsFromRelations(relations) {
  if (!relations) return null;
  const credits = [];
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  for (const rel of relations) {
    let creditLine = '';
    const type = rel.type || '';

    if (rel['target-type'] === 'artist') {
        // Fetch all artist credits
        let label = capitalize(type);
        const lowerType = type.toLowerCase().trim();

        if (lowerType === 'remix') {
             creditLine = `Remix by ${rel.artist.name}`;
        } else {
             if (rel['type-id'] === 'b6e035f4-3ce9-331c-97df-83397230b0df') label = 'DJ-Mixer';
             else if (lowerType === 'dj-mixer' || lowerType === 'mix-dj' || lowerType === 'dj-mix') label = 'DJ-Mixer';
             else if (lowerType === 'misc') label = 'Miscellaneous support';
             creditLine = `${label}: ${rel.artist.name}`;
        }
        if (rel.attributes && rel.attributes.length > 0) {
             creditLine += ` (${rel.attributes.join(', ')})`;
        }
    } else if (rel['target-type'] === 'place' && type === 'recorded at') {
        creditLine = `Recorded at: ${rel.place.name}`;
        if (rel.place.area && rel.place.area.name) creditLine += ` in ${rel.place.area.name}`;
        if (rel.begin) creditLine += ` (on ${rel.begin})`;
    } else if (rel['target-type'] === 'area' && type === 'recorded in') {
        creditLine = `Recorded in: ${rel.area.name}`;
        if (rel.begin) creditLine += ` (on ${rel.begin})`;
    }

    if (creditLine) credits.push(creditLine);
  }
  // Join with <br> for vertical stacking
  return credits.length > 0 ? credits.join('<br>') : null;
}

/**
 * Main function to fetch all data, process it, and save it to a file.
 */
async function main() {
  console.log('🚀 Starting discography fetch...');
  if (USER_AGENT.includes('your-email@example.com')) {
    console.warn('⚠️ WARNING: User-Agent is not set. Please update it in the script to avoid API errors.');
  }

  // 0. Get BaseURL from hugo.toml to identify internal links
  let siteBaseUrl = '';
  try {
      const hugoConfigPath = path.join(projectRoot, 'hugo.toml');
      if (fs.existsSync(hugoConfigPath)) {
            const hugoContent = fs.readFileSync(hugoConfigPath, 'utf-8');
            const match = hugoContent.match(/^baseURL\s*=\s*["']([^"']+)["']/mi);
            if (match) {
                siteBaseUrl = match[1].replace(/\/$/, ''); // Remove trailing slash
                console.log(`ℹ️ Found baseURL in hugo.toml: ${siteBaseUrl}`);
            }
      }
  } catch (e) {
      console.warn("⚠️ Could not read hugo.toml for baseURL. 'Read More' links will be disabled.", e);
  }

  try {
    const releaseGroupDataMap = new Map(); // Stores { id, title, release date, primaryType, secondaryTypes, isRemixContribution, links }

    // --- Pass 1: Fetch Artist's Primary Release Groups (Albums, EPs, Singles, etc.) ---
    // This pass is now more robust. It fetches each release type from your config individually
    // to work around a MusicBrainz API issue where combining types can yield incomplete results.
    console.log('🚀 Starting Pass 1: Fetching primary release groups by type...');
    const releaseTypesToFetch = RELEASE_TYPES.split('|');

    for (const type of releaseTypesToFetch) {
      if (!type) continue; // Skip empty strings if config has trailing |
      console.log(`--- Fetching type: ${type} ---`);
      let offset = 0;
      let totalCount = 0;
      const baseUrlForType = `https://musicbrainz.org/ws/2/release-group?artist=${ARTIST_ID}&type=${type}&fmt=json`;

      do {
        const pageUrl = `${baseUrlForType}&limit=${API_LIMIT}&offset=${offset}`;
        console.log(`Fetching page: ${pageUrl}`);
        const pageData = await politeFetchData(pageUrl);

        if (!pageData || !pageData['release-groups']) {
          console.warn(`Warning: No release groups found or invalid data on page: ${pageUrl}`);
          if (offset === 0 && (!pageData || pageData['release-group-count'] === 0)) {
            totalCount = 0; // Ensure loop terminates if first page is empty
          } else if (!pageData) {
            break; // Critical error, stop fetching this type
          }
        }

        const releaseGroupsOnPage = pageData['release-groups'] || [];
        for (const rg of releaseGroupsOnPage) {
          if (!releaseGroupDataMap.has(rg.id)) {
            releaseGroupDataMap.set(rg.id, {
              id: rg.id,
              title: rg.title,
              release_date: rg['first-release-date'] || '',
              primaryType: rg['primary-type'],
              secondaryTypes: rg['secondary-types'] || [],
              isRemixContribution: false,
              links: []
            });
          }
        }

        if (offset === 0) {
          totalCount = pageData['release-group-count'] || 0;
          if (totalCount > 0) {
            console.log(`Found a total of ${totalCount} RGs of type '${type}'. Fetching all pages...`);
          } else {
            console.log(`Found 0 RGs of type '${type}'.`);
          }
        }
        offset += releaseGroupsOnPage.length;
        if (releaseGroupsOnPage.length === 0 && offset < totalCount) {
          console.warn(`No releases on page but expected more. Offset: ${offset}, Total: ${totalCount}. Continuing...`);
        }

      } while (offset < totalCount && totalCount > 0);
      console.log(`--- Finished fetching type: ${type}. Map now has ${releaseGroupDataMap.size} unique RGs. ---`);
    }
    console.log(`✅ Pass 1 complete. Map has ${releaseGroupDataMap.size} unique RGs from primary scan.`);

    // --- Pass 2: Fetch Release Groups containing Artist's Remixes/Edits ---
    console.log('🚀 Starting Pass 2: Fetching recordings remixed/edited by the artist...');
    const artistRelsUrl = `https://musicbrainz.org/ws/2/artist/${ARTIST_ID}?inc=recording-rels&fmt=json`;
    console.log(`Fetching artist relations: ${artistRelsUrl}`);
    const artistData = await politeFetchData(artistRelsUrl);
    
    if (!artistData) {
      console.error(`❌ Failed to fetch artist relations from ${artistRelsUrl}. Skipping Pass 2 for remixes/edits.`);
    } else if (!artistData.relations || artistData.relations.length === 0) {
      console.warn(`ℹ️ Artist relations data from ${artistRelsUrl} does not contain a 'relations' array or it's empty. No remixes/edits to process from relations.`);
    } else {
      const relatedRecordingIds = [];
      for (const relation of artistData.relations) {
        if ((relation.type === 'remixer' || relation.type === 'editor') &&
            relation['target-type'] === 'recording' && relation.recording) {
          console.log(`✅ Pass 2: Found relevant relation: type=${relation.type}, recording ID=${relation.recording.id}, title="${relation.recording.title}"`);
          relatedRecordingIds.push(relation.recording.id); // Collect unique recording IDs
        }
      }
      console.log(`Found ${relatedRecordingIds.length} unique recordings where artist is remixer/editor. Fetching their releases...`);
      if (relatedRecordingIds.length === 0) {
        console.log("ℹ️ Pass 2: No recordings found with 'remixer' or 'editor' relationships. If you expect some, check MusicBrainz data for the artist.");
      }

      for (const recId of relatedRecordingIds) {
        const recordingDetailsUrl = `https://musicbrainz.org/ws/2/recording/${recId}?inc=releases&fmt=json`;
        console.log(`➡️ Pass 2: Fetching details for recording ID ${recId}: ${recordingDetailsUrl}`);
        const recData = await politeFetchData(recordingDetailsUrl); // Use politeFetchData

        if (!recData) {
            console.warn(`⚠️ Failed to fetch recording details from ${recordingDetailsUrl} for recId ${recId}. Skipping this recording.`);
            continue; 
        }

        if (!recData.releases || recData.releases.length === 0) {
            console.log(`ℹ️ Recording ${recId} (fetched from ${recordingDetailsUrl}) has no releases listed or 'releases' array is missing. Skipping.`);
            continue;
        }
        if (recData && recData.releases && recData.releases.length > 0) {
          for (const releaseOn of recData.releases) {
            let rgData = releaseOn['release-group'];
            
            if (!rgData && releaseOn.id) {
              // If release-group is missing, try fetching the release details to get it
              console.log(`  ℹ️ Pass 2: Release "${releaseOn.title}" (ID: ${releaseOn.id}) for recording ${recId} is missing 'release-group' data. Attempting to fetch release details...`);
              // Fetch the specific release to get its release-group and relations
              const releaseDetailsUrl = `https://musicbrainz.org/ws/2/release/${releaseOn.id}?inc=release-groups+url-rels&fmt=json`; // Added url-rels here
              const specificReleaseData = await politeFetchData(releaseDetailsUrl); // Use politeFetchData
              if (specificReleaseData && specificReleaseData['release-group']) {
                console.log(`    ✅ Pass 2: Successfully fetched 'release-group' for release ID ${releaseOn.id}.`);
                rgData = specificReleaseData['release-group'];
                // Links for this RG will be fetched in the final pass
              } else {
                console.log(`    ❌ Pass 2: Still could not find 'release-group' for release ID ${releaseOn.id} after fetching details. Skipping this release entry.`);
                continue; // Skip this release if RG still not found
              }
            } 

            if (rgData) {
              const rgId = rgData.id;
              
              // If this RG is new to our map, add a basic entry. Links will be fetched in the final pass.
              if (!releaseGroupDataMap.has(rgId)) {
                    releaseGroupDataMap.set(rgId, {
                        id: rgId,
                        title: rgData.title,
                        release_date: rgData['first-release-date'] || releaseOn.date || '',
                        primaryType: rgData['primary-type'],
                        secondaryTypes: rgData['secondary-types'] || [],
                        isRemixContribution: true,
                        links: [] // Initialize with empty links
                    });
                    console.log(`    ✅ Pass 2: Added new RG "${rgData.title}" to map.`);
              } else {
                const existingEntry = releaseGroupDataMap.get(rgId);
                existingEntry.isRemixContribution = true; // Mark that this RG also contains a remix
                console.log(`    🔄 Pass 2: Updated existing RG "${rgId}" ("${rgData.title}") in map, marked as remix/edit contribution.`);
              }
            } else {
              console.log(`  ℹ️ Pass 2: Release "${releaseOn.title}" (ID: ${recId}) for recording ${recId} is missing 'release-group' data even after potential fetch. Skipping this release entry.`);
            }
          }
        }
      }
    }
    console.log(`✅ Pass 2 complete. Map now has ${releaseGroupDataMap.size} unique RGs considering remixes.`);

    if (releaseGroupDataMap.size === 0) {
      console.error('❌ No release groups found after all passes. Check artist ID, User-Agent, and API responses.');
      return;
    }

    console.log(`Processing ${releaseGroupDataMap.size} unique release groups for final output, cover art, and LINKS...`);

    const discographyPromises = Array.from(releaseGroupDataMap.values()).map(async (entry) => {
      const cover_art = await getCoverArtUrl(entry.id); // CoverArtArchive calls are not delayed by politeFetchData
      
      // --- FETCH ANNOTATION ---
      let annotation = '';
      try {
          const rgDetailsUrl = `https://musicbrainz.org/ws/2/release-group/${entry.id}?inc=annotation&fmt=json`;
          const rgDetails = await politeFetchData(rgDetailsUrl);
          if (rgDetails && rgDetails.annotation) {
              annotation = rgDetails.annotation;
          }
      } catch (e) {
          console.warn(`Could not fetch annotation for RG ${entry.id}: ${e.message}`);
      }
      
      // --- AGGRESSIVE LINK FETCHING & MEDIA FORMAT COLLECTION ---
      let finalLinks = [];
      let relatedBlogPost = '';
      let foundMediaFormats = new Set(); // New Set to store media formats for categorisation
      let uniqueTracklists = new Map(); // Map to store unique tracklists

      console.log(`\n--- Checking links for RG "${entry.title}" (ID: ${entry.id}) ---`);
      
      // Step 1: Get all releases for this release group
      const rgReleasesUrl = `https://musicbrainz.org/ws/2/release-group/${entry.id}?inc=releases&fmt=json`;
      console.log(`DEBUG: Fetching releases for RG ${entry.id} from ${rgReleasesUrl}`);
      const rgReleasesData = await politeFetchData(rgReleasesUrl);

      if (rgReleasesData && rgReleasesData.releases && rgReleasesData.releases.length > 0) {
        console.log(`DEBUG: Found ${rgReleasesData.releases.length} individual releases for RG "${entry.title}".`);
        for (const release of rgReleasesData.releases) {
          // Collect media format here
          if (release.media?.[0]?.format) {
            foundMediaFormats.add(release.media[0].format);
            console.log(`DEBUG: Found media format '${release.media[0].format}' for release ${release.id}.`);
          }

          console.log(`DEBUG: Checking individual release "${release.title}" (ID: ${release.id}) for links. Type: ${release.media?.[0]?.format || 'N/A'}`);
          const releaseDetailsUrl = `https://musicbrainz.org/ws/2/release/${release.id}?inc=url-rels+recordings+artist-credits+recording-level-rels+artist-rels+place-rels+area-rels&fmt=json`; // Added release-level rels
          console.log(`DEBUG: Fetching details for release ${release.id}: ${releaseDetailsUrl}`);
          const releaseDetails = await politeFetchData(releaseDetailsUrl);
          
          if (releaseDetails && releaseDetails.relations && releaseDetails.relations.length > 0) {
            console.log(`DEBUG: Release ${release.id} has ${releaseDetails.relations.length} relations. Parsing...`);
            const newLinks = parseLinks(releaseDetails.relations);
            finalLinks = [...finalLinks, ...newLinks]; // Aggregate links (parseLinks already deduplicates and sorts)
            
            // Check for related blog post (Internal Link)
            if (siteBaseUrl) {
                const blogRel = releaseDetails.relations.find(r => 
                    r.url && 
                    r.url.resource && 
                    r.url.resource.startsWith(siteBaseUrl) &&
                    (r.url.resource.includes('/blog/') || r.url.resource.includes('/news/'))
                );
                if (blogRel) {
                    relatedBlogPost = blogRel.url.resource;
                    console.log(`    🔗 Found related blog post: ${relatedBlogPost}`);
                }
            }

            // --- TRACKLIST COLLECTION LOGIC ---
            if (releaseDetails.media) {
                // Generate a signature based on the track content to identify identical tracklists
                const signatureObj = releaseDetails.media.map(m => ({
                    trackCount: m['track-count'],
                    tracks: (m.tracks || []).map(t => ({
                        title: t.title,
                        artist: getArtistCreditString(t['artist-credit'])
                    }))
                }));
                const signature = JSON.stringify(signatureObj);

                // Calculate a richness score based on presence of recording credits
                let currentRichness = 0;
                const releaseCredits = getCreditsFromRelations(releaseDetails.relations);
                if (releaseCredits) currentRichness += releaseCredits.length;

                releaseDetails.media.forEach(m => {
                    if (m.tracks) {
                        m.tracks.forEach(t => {
                            const creds = getCreditsFromRelations(t.recording?.relations);
                            if (creds) currentRichness += creds.length;
                        });
                    }
                });

                if (!uniqueTracklists.has(signature)) {
                    uniqueTracklists.set(signature, {
                        media: releaseDetails.media,
                        formats: new Set(),
                        richness: currentRichness,
                        releaseCredits: releaseCredits
                    });
                } else {
                    // If the current release has more credits data than the stored one, replace the media
                    const stored = uniqueTracklists.get(signature);
                    if (currentRichness > (stored.richness || 0)) {
                         stored.media = releaseDetails.media;
                         stored.richness = currentRichness;
                         stored.releaseCredits = releaseCredits;
                    }
                }
                
                // Add formats from this release to the set
                releaseDetails.media.forEach(m => {
                    if (m.format) uniqueTracklists.get(signature).formats.add(m.format);
                });
            }
          } else {
              console.log(`DEBUG: Release ${release.id} has no relations or invalid data.`);
          }
        }
        // The finalLinks array already contains unique, parsed, and sorted links from parseLinks calls.
        // No need to call parseLinks again on an already processed array.
        if (finalLinks.length > 0) {
            console.log(`✅ Found ${finalLinks.length} unique links for RG "${entry.title}" after checking all its releases.`);
        } else {
            console.log(`ℹ️ Still no links found for RG "${entry.title}" after checking all its releases.`);
        }
      } else {
          console.log(`DEBUG: No individual releases found for RG "${entry.title}" or invalid data from ${rgReleasesUrl}.`);
      }

      // If we found a related blog post, ensure it doesn't appear in the generic "Buy/Stream" links list
      if (relatedBlogPost && finalLinks.length > 0) {
        finalLinks = finalLinks.filter(l => l.url !== relatedBlogPost);
      }

      // Process uniqueTracklists into the final output format
      const processedTracklists = Array.from(uniqueTracklists.values()).map(entry => {
          // Sort formats alphabetically as requested
          const sortedFormats = Array.from(entry.formats).sort();
          let formatsStr = '';
          if (sortedFormats.length > 1) {
              const last = sortedFormats.pop();
              formatsStr = sortedFormats.join(', ') + ' & ' + last;
          } else if (sortedFormats.length === 1) {
              formatsStr = sortedFormats[0];
          } else {
              formatsStr = 'Unknown Format';
          }

          return {
              formats: formatsStr,
              media: entry.media.map(m => ({
                  format: m.format,
                  tracks: (m.tracks || []).map(t => ({
                      position: t.position || t.number,
                      title: t.title,
                      length: formatDuration(t.length),
                      artist: getArtistCreditString(t['artist-credit']),
                      credits: [
                          getCreditsFromRelations(t.recording?.relations),
                          entry.releaseCredits
                      ].filter(Boolean).join('<br>')
                  }))
              }))
          };
      });

      // Sort tracklists by total track count (descending) so the most complete one is first
      processedTracklists.sort((a, b) => {
          const countA = a.media.reduce((acc, m) => acc + m.tracks.length, 0);
          const countB = b.media.reduce((acc, m) => acc + m.tracks.length, 0);
          return countB - countA;
      });

      // --- END AGGRESSIVE LINK FETCHING & MEDIA FORMAT COLLECTION ---
      
      let category = entry.primaryType; // Default to primary type
      const titleLower = entry.title.toLowerCase();
      let categorizationReason = `Primary type: ${entry.primaryType}`;

      // --- NEW CATEGORIZATION LOGIC ---
      // Prioritize more specific categories first
      if (foundMediaFormats.has('DVD-Video') || foundMediaFormats.has('DVD')) { // Check for DVD media format
        category = 'DVD';
        categorizationReason = "Contains DVD media format";
      } else if (entry.secondaryTypes.includes('DJ-mix')) {
        category = 'DJ Mix';
        categorizationReason = "Secondary type: DJ-mix";
      } else if (entry.secondaryTypes.includes('Live')) {
        category = 'Live Album';
        categorizationReason = "Secondary type: Live";
      } else if (entry.secondaryTypes.includes('Compilation')) {
        category = 'Compilation';
        categorizationReason = "Secondary type: Compilation";
      }
      // "Remix Album" (where our artist is the album artist, and it's a collection of remixes by others)
      // This is tricky. MusicBrainz doesn't have a direct 'Remix Album' primary type for this scenario.
      // It might be an 'Album' primary type with 'Remix' secondary type, but that overlaps with remix EPs.
      // For now, we'll keep the existing 'Remix' logic, and you can refine this specific case later.
      else if (entry.secondaryTypes.includes('Remix')) { // RG is itself a "Remix" album/EP
        category = 'Remix';
        categorizationReason = "Secondary type: Remix";
      } else if (entry.isRemixContribution) { // RG contains a remix by our artist
        category = 'Remix';
        categorizationReason = "Artist contribution (isRemixContribution true)";
      } else if (titleLower.includes('remix') || titleLower.includes('edit') || titleLower.includes('rework')) {
        // Heuristic: if title suggests it's a remix/edit/rework, categorize as Remix
        category = 'Remix';
        categorizationReason = `Title heuristic (contains: ${titleLower.includes('remix') ? 'remix' : titleLower.includes('edit') ? 'edit' : 'rework'})`;
      }
      // --- END NEW CATEGORIZATION LOGIC ---

      // Log the categorisation decision for items that become "Remix" or "DJ-mix"
      if (['Remix', 'DJ Mix', 'Live Album', 'Compilation', 'DVD'].includes(category) && category !== entry.primaryType) {
        console.log(`ℹ️ Categorising "${entry.title}" (ID: ${entry.id}) as "${category}" because: ${categorizationReason}`);
      }
 
       return {
         id: entry.id, // Ensure ID is included in the final output
         title: entry.title,
         release_date: entry.release_date, // Include the full date in the final output
         category: category,
         cover_art: cover_art,
         links: finalLinks, // Include the aggregated links
         related_link: relatedBlogPost,
         annotation: annotation,
         tracklist: processedTracklists
       };
     });
 
     const formattedDiscography = await Promise.allSettled(discographyPromises)
        .then(results => {
            const fulfilled = results.filter(result => result.status === 'fulfilled').map(result => result.value);
            const rejected = results.filter(result => result.status === 'rejected');
            if (rejected.length > 0) {
                console.error(`❌ ${rejected.length} discography items failed to process during final pass:`);
                rejected.forEach(r => console.error(`  - Reason: ${r.reason}`));
            }
            return fulfilled;
        });
 
     // Add a summary of the cover art fetch results
     const foundArtCount = formattedDiscography.filter(item => item.cover_art !== PLACEHOLDER_IMG).length;
     console.log(`✅ Cover art scan complete. Found art for ${foundArtCount} of ${formattedDiscography.length} releases.`);
 
     // Sort by release date, descending
     formattedDiscography.sort((a, b) => b.release_date.localeCompare(a.release_date));
 
     // Check for duplicates by title in formattedDiscography
     const titlesInFinal = formattedDiscography.map(item => item.title);
     const duplicateTitles = titlesInFinal.filter((title, index) => titlesInFinal.indexOf(title) !== index);
     if (duplicateTitles.length > 0) {
         console.warn(`⚠️ WARNING: Found duplicate titles in final discography data:`);
         duplicateTitles.forEach(dupTitle => {
             console.warn(`  - Title: "${dupTitle}"`);
         });
     } else {
         console.log('✅ No duplicate titles found in the final discography data.');
     }
     console.log(`Total items in formattedDiscography: ${formattedDiscography.length}`);
     try {
         // Ensure the data directory exists.
         if (!fs.existsSync(DATA_DIR)) {
            console.log(`Creating data directory at: ${DATA_DIR}`);
            fs.mkdirSync(DATA_DIR, { recursive: true });
         }
 
         const jsonData = JSON.stringify(formattedDiscography, null, 2);
 
         console.log(`\n📝 Writing data file to: ${OUT_FILE}`);
         fs.writeFileSync(OUT_FILE, jsonData);
         console.log(`✅✅✅ Discography data successfully saved.`);

         // --- Generate individual Markdown files for each discography item ---
         console.log('\nGenerating individual discography content pages...');
         const contentDir = path.resolve(__dirname, '../../../../content/discography');
         if (!fs.existsSync(contentDir)) {
             fs.mkdirSync(contentDir, { recursive: true });
         }

         for (const item of formattedDiscography) {
             const categorySlug = slugify(item.category);
             const titleSlug = slugify(item.title);
             const itemDir = path.join(contentDir, categorySlug, titleSlug);
             const itemFilePath = path.join(itemDir, 'index.md');

             if (!fs.existsSync(itemDir)) {
                 fs.mkdirSync(itemDir, { recursive: true });
             }

             const frontMatter = `---
title: "${item.title.replace(/"/g, '\\"')}"
mbid: "${item.id}"
category: "${item.category}"
related_link: "${item.related_link || ''}"
layout: "discography/single"
---
`;
             fs.writeFileSync(itemFilePath, frontMatter);
             // console.log(`Generated: ${itemFilePath}`); // Too verbose, keep quiet unless error
         }
         console.log(`✅ Generated ${formattedDiscography.length} discography content pages.`);

         console.log('\n------------------------------------------------------------------');
         console.log('💖 This script relies on the amazing free services from MusicBrainz and the Internet Archive.');
         console.log('   If you find this useful, please consider supporting their work:');
         console.log('   - MusicBrainz (MetaBrainz Foundation): https://metabrainz.org/donate');
         console.log('   - Cover Art Archive (Internet Archive): https://archive.org/donate');
         console.log('------------------------------------------------------------------');
     } catch (writeError) {
         console.error(`❌❌❌ ERROR writing data file:`, writeError);
     }
 
   } catch (error) {
     console.error('❌ An error occurred during the fetch process:', error);
   }
 }
 
 // Run the main function
 main();
