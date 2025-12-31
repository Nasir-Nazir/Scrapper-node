const express = require("express");
const cors = require("cors");
const {
  Scraper,
  Root,
  OpenLinks,
  CollectContent,
} = require("nodejs-web-scraper");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Google Scraper API",
    endpoints: {
      search: "GET /search?q=your-query&pages=1",
      example: "GET /search?q=nodejs+tutorial&pages=1",
    },
    note: "Use responsibly and comply with Google Terms of Service",
  });
});

// Main search endpoint
app.get("/search", async (req, res) => {
  try {
    const { q: query, pages = 1, lang = "en" } = req.query;

    // Validate query
    if (!query || query.trim() === "") {
      return res.status(400).json({
        error: "Query parameter (q) is required",
        example: "/search?q=nodejs+tutorial&pages=2",
      });
    }

    // Set CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    // Start scraping
    const results = await scrapeGoogle(query, parseInt(pages), lang);

    res.json({
      success: true,
      query,
      pages: parseInt(pages),
      totalResults: results.length,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error("Scraping error:", error.message);

    res.status(500).json({
      success: false,
      error: "Failed to scrape Google",
      message: error.message,
      suggestion: "Try again later or reduce the number of pages",
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Google Scraper API",
  });
});

// Google scraping function
async function scrapeGoogle(query, pages = 1, lang = "en") {
  const encodedQuery = encodeURIComponent(query);
  const results = [];

  const config = {
    baseSiteUrl: "https://www.google.com",
    startUrl: `https://www.google.com/search?q=${encodedQuery}&hl=${lang}`,
    concurrency: 2, // Conservative to avoid rate limiting
    maxRetries: 2,
    delay: 5000, // Delay between requests to avoid blocking
    timeout: 15000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": `${lang}-US,${lang};q=0.9`,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      Referer: "https://www.google.com/",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
    },
    removeStyleAndScriptTags: true,
  };

  const scraper = new Scraper(config);

  // Create page object function
  const getPageObject = (pageObject, address) => {
    if (pageObject.title && pageObject.title[0]) {
      results.push({
        title: pageObject.title[0],
        link: pageObject.link ? pageObject.link[0] : null,
        snippet: pageObject.snippet ? pageObject.snippet[0] : null,
        source: address,
      });
    }
  };

  const root = new Root({
    pagination: {
      queryString: "start",
      begin: 0,
      end: (pages - 1) * 10,
      offset: 10, // Google uses offset pagination (0, 10, 20...)
    },
  });

  // Create operations
  const searchResults = new OpenLinks(".yuRUbf a", {
    name: "searchResult",
    getPageObject,
    slice: [0, 9], // Get first 10 results
  });

  const titles = new CollectContent("h1, h2, h3", { name: "title" });
  const links = new CollectContent('a[href^="http"]', {
    name: "link",
    condition: (element) => {
      const href = element.attr("href");
      return href && !href.includes("google.com") && !href.startsWith("/");
    },
  });
  const snippets = new CollectContent(".VwiC3b, .MUxGbd, .yDYNvb", {
    name: "snippet",
  });

  // Build scraping tree
  root.addOperation(searchResults);
  searchResults.addOperation(titles);
  searchResults.addOperation(links);
  searchResults.addOperation(snippets);

  // Add direct collection from search results page
  const directTitles = new CollectContent(".yuRUbf h3", {
    name: "directTitle",
    getAllItems: (items, address) => {
      items.forEach((title, index) => {
        if (title && !results.some((r) => r.title === title)) {
          results.push({
            title: title,
            link: null, // We can't get link directly here
            snippet: null,
            source: "search results page",
          });
        }
      });
    },
  });

  root.addOperation(directTitles);

  // Execute scraping
  await scraper.scrape(root);

  // Clean and deduplicate results
  const uniqueResults = results.filter(
    (result, index, self) =>
      index === self.findIndex((r) => r.title === result.title)
  );

  return uniqueResults.slice(0, pages * 10); // Limit to requested pages
}

// Handle 404
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    availableEndpoints: [
      "GET /",
      "GET /search?q=your-query",
      "GET /search?q=your-query&pages=2",
      "GET /health",
    ],
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Export for Vercel serverless
module.exports = app;

// Local development server (won't run on Vercel)
if (require.main === module) {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Test with: http://localhost:${PORT}/search?q=nodejs`);
  });
}
