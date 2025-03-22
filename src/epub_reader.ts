import JSZip from "jszip";
import fs from "fs";
import path from "path";
import { DOMParser } from "xmldom";

export interface EPUBMetadata {
    title: string;
    author: string;
    language: string;
}

export async function extractEPUB(filePath: string): Promise<EPUBMetadata | null> {
    try {
        const zip = new JSZip();
        const data = fs.readFileSync(filePath);
        const epubData = await zip.loadAsync(data);

        // Locate content.opf
        const containerPath = "META-INF/container.xml";
        const containerXml = await epubData.files[containerPath].async("text");
        const contentOpfPath = parseContainerXML(containerXml);

        if (!contentOpfPath) {
            console.error("content.opf not found.");
            return null;
        }

        // Extract metadata
        const metadata = await extractMetadata(epubData, contentOpfPath);

        // Extract first 500 characters of text
        const previewText = await extractPreviewText(epubData, contentOpfPath);

        return { ...metadata, previewText };
    } catch (error) {
        console.error("Error extracting EPUB:", error);
        return null;
    }
}

// Parses container.xml to find content.opf path
function parseContainerXML(xmlText: string): string | null {
    const xmlDoc = new DOMParser().parseFromString(xmlText, "text/xml");
    const rootfile = xmlDoc.getElementsByTagName("rootfile")[0];
    return rootfile ? rootfile.getAttribute("full-path") : null;
}

// Extract metadata from content.opf
async function extractMetadata(zip: JSZip, contentOpfPath: string): Promise<EPUBMetadata> {
    const xmlText = await zip.files[contentOpfPath].async("text");
    const xmlDoc = new DOMParser().parseFromString(xmlText, "text/xml");
    console.log(xmlText);

    return {
        title: xmlDoc.getElementsByTagName("dc:title")[0]?.textContent || "Unknown Title",
        author: xmlDoc.getElementsByTagName("dc:creator")[0]?.textContent || "Unknown Author",
        language: xmlDoc.getElementsByTagName("dc:language")[0]?.textContent || "Unknown Language",
    };
}

async function extractPreviewText(zip: JSZip, contentOpfPath: string): Promise<string> {
    const xmlText = await zip.files[contentOpfPath].async("text");
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");

    // Find first <itemref> in <spine>
    const firstItemRef = doc.getElementsByTagName("spine")[0]?.getElementsByTagName("itemref")[0];
    if (!firstItemRef) return "No valid chapters found.";

    const firstIdRef = firstItemRef.getAttribute("idref");
    if (!firstIdRef) return "No valid chapters found.";

    // Find corresponding <item> in <manifest>
    const items = doc.getElementsByTagName("manifest")[0]?.getElementsByTagName("item");
    let firstFilePath: string | null = null;

    for (let i = 0; i < items.length; i++) {
        if (items[i].getAttribute("id") === firstIdRef) {
            firstFilePath = items[i].getAttribute("href");
            break;
        }
    }

    if (!firstFilePath) return "Text file not found in EPUB.";

    // ✅ Fix the path issue
    const baseFolder = path.dirname(contentOpfPath); // Get the folder of content.opf
    const resolvedPath = path.join(baseFolder, firstFilePath).replace(/\\/g, "/"); // Ensure it's Unix-style

    if (!zip.files[resolvedPath]) return "Text file not found in EPUB.";

    // Extract raw text
    const rawHTML = await zip.files[resolvedPath].async("text");
    const strippedText = rawHTML.replace(/<[^>]+>/g, ""); // Remove HTML tags
    return strippedText.substring(0, 5000);
}
