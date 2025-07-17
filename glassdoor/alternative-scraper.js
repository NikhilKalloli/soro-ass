const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

class AlternativeGlassdoorScraper {
    constructor() {
        this.jobs = [];
        this.proxyRotation = 0;
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0'
        ];
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    getHeaders() {
        return {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Charset': 'utf-8',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
            'Pragma': 'no-cache',
            'sec-ch-ua': '"Google Chrome";v="120", "Chromium";v="120", "Not_A Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"'
        };
    }

    async delay(min = 2000, max = 5000) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        console.log(`⏳ Waiting ${delay}ms...`);
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    // Method 1: Try direct scraping with enhanced headers
    async scrapeDirectly(searchTerm, location, pages = 1) {
        console.log(`🔍 Method 1: Direct scraping for "${searchTerm}" in "${location}"`);
        
        for (let page = 1; page <= pages; page++) {
            try {
                await this.delay(3000, 7000); // Random delay between requests
                
                console.log(`\n📄 Scraping page ${page}...`);
                
                // Build search URL
                const searchUrl = `https://www.glassdoor.com/Job/jobs.htm?suggestCount=0&suggestChosen=false&clickSource=searchBtn&typedKeyword=${encodeURIComponent(searchTerm)}&sc.keyword=${encodeURIComponent(searchTerm)}&locT=C&locId=1147401&jobType=&context=Jobs&p=${page}`;
                
                const response = await axios.get(searchUrl, {
                    headers: this.getHeaders(),
                    timeout: 20000,
                    maxRedirects: 5,
                    validateStatus: function (status) {
                        return status < 500; // Resolve only if the status code is less than 500
                    }
                });

                if (response.status === 403 || response.status === 429) {
                    console.log(`❌ Blocked (Status ${response.status}). Try Method 2 or 3.`);
                    return [];
                }

                const $ = cheerio.load(response.data);
                
                // Try multiple selectors for job listings
                const jobSelectors = [
                    '[data-test="job-listing"]',
                    '.react-job-listing',
                    '.jobContainer',
                    '.job-search-key-*',
                    '[data-id*="job"]',
                    '.JobCard',
                    '.jobListing'
                ];

                let jobElements = $();
                for (const selector of jobSelectors) {
                    jobElements = $(selector);
                    if (jobElements.length > 0) {
                        console.log(`✅ Found jobs using selector: ${selector}`);
                        break;
                    }
                }

                if (jobElements.length === 0) {
                    console.log('⚠️  No job listings found. Website structure may have changed.');
                    // Try to save the HTML for debugging
                    fs.writeFileSync(`glassdoor_debug_page${page}.html`, response.data);
                    console.log(`💾 Saved HTML to glassdoor_debug_page${page}.html for analysis`);
                    break;
                }

                console.log(`Found ${jobElements.length} job listings on page ${page}`);

                // Extract job data
                for (let i = 0; i < jobElements.length; i++) {
                    const jobElement = $(jobElements[i]);
                    
                    try {
                        const job = await this.extractJobData($, jobElement, 'direct');
                        if (job.title && job.company) {
                            this.jobs.push(job);
                            console.log(`✅ Extracted: ${job.title} at ${job.company}`);
                        }
                    } catch (error) {
                        console.log(`❌ Error extracting job ${i + 1}: ${error.message}`);
                    }
                }

            } catch (error) {
                console.error(`❌ Error on page ${page}: ${error.message}`);
                if (error.response?.status === 403 || error.response?.status === 429) {
                    console.log('🚫 Blocked by Glassdoor. Try alternative methods.');
                    break;
                }
            }
        }

        return this.jobs;
    }

    // Method 2: Scrape using mobile version (often less protected)
    async scrapeMobileVersion(searchTerm, location) {
        console.log(`📱 Method 2: Mobile version scraping for "${searchTerm}" in "${location}"`);
        
        try {
            await this.delay(2000, 4000);
            
            const mobileHeaders = {
                ...this.getHeaders(),
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
            };
            
            const searchUrl = `https://www.glassdoor.com/Job/jobs.htm?suggestCount=0&suggestChosen=false&clickSource=searchBtn&typedKeyword=${encodeURIComponent(searchTerm)}&sc.keyword=${encodeURIComponent(searchTerm)}&locT=C&locId=1147401&jobType=&context=Jobs`;
            
            const response = await axios.get(searchUrl, {
                headers: mobileHeaders,
                timeout: 20000
            });
            
            const $ = cheerio.load(response.data);
            
            // Mobile-specific selectors
            const mobileJobElements = $('.jobListing, .job-tile, .mobile-job-item, [data-test="job-listing"]');
            
            console.log(`Found ${mobileJobElements.length} jobs on mobile version`);
            
            for (let i = 0; i < mobileJobElements.length; i++) {
                const jobElement = $(mobileJobElements[i]);
                
                try {
                    const job = await this.extractJobData($, jobElement, 'mobile');
                    if (job.title && job.company) {
                        this.jobs.push(job);
                        console.log(`✅ Mobile extracted: ${job.title} at ${job.company}`);
                    }
                } catch (error) {
                    console.log(`❌ Mobile error ${i + 1}: ${error.message}`);
                }
            }
            
        } catch (error) {
            console.error(`❌ Mobile scraping failed: ${error.message}`);
        }
        
        return this.jobs;
    }

    async extractJobData($, jobElement, method) {
        // Enhanced selectors for different page versions
        const selectors = {
            title: [
                '[data-test="job-title"]',
                '.jobTitle a',
                '.job-title',
                'h3 a', 'h2 a', 'h4 a',
                '.JobCard_jobTitle__*',
                '.jobInfoItem .jobTitle',
                '.job-link',
                'a[data-test="job-link"]'
            ],
            company: [
                '[data-test="employer-name"]',
                '.employerName',
                '.employer-name',
                '.company',
                '.JobCard_employerName__*',
                '.companyName',
                '.job-company'
            ],
            location: [
                '[data-test="job-location"]',
                '.location',
                '.loc',
                '.jobLocation',
                '.JobCard_location__*',
                '.job-location',
                '.location-info'
            ]
        };

        const job = {};

        // Extract basic info
        for (const [field, selectorArray] of Object.entries(selectors)) {
            for (const selector of selectorArray) {
                const element = jobElement.find(selector).first();
                if (element.length > 0) {
                    const text = element.text().trim();
                    if (text) {
                        job[field] = text;
                        break;
                    }
                }
            }
        }

        // Try to get job URL
        const urlSelectors = [
            '[data-test="job-title"] a',
            '.jobTitle a',
            '.job-title a',
            'h3 a', 'h2 a',
            'a[data-test="job-link"]'
        ];

        let jobUrl = '';
        for (const selector of urlSelectors) {
            const element = jobElement.find(selector).first();
            if (element.length > 0) {
                let href = element.attr('href');
                if (href) {
                    jobUrl = href.startsWith('http') ? href : `https://www.glassdoor.com${href}`;
                    break;
                }
            }
        }

        // Simple job description extraction (from listing page)
        let jobDescription = 'Job description not available';
        const descElements = jobElement.find('.jobDescription, .job-desc, .snippet, .job-snippet');
        if (descElements.length > 0) {
            jobDescription = descElements.first().text().trim();
        }

        return {
            title: job.title || 'N/A',
            company: job.company || 'N/A',
            location: job.location || 'N/A',
            job_description: jobDescription,
            jobUrl: jobUrl || 'N/A',
            scraped_at: new Date().toISOString(),
            method: method
        };
    }

    async saveToFile(filename = 'glassdoor_jobs_alternative.json') {
        try {
            fs.writeFileSync(filename, JSON.stringify(this.jobs, null, 2), 'utf8');
            console.log(`\n💾 Saved ${this.jobs.length} jobs to ${filename}`);
        } catch (error) {
            console.error(`❌ Error saving to file: ${error.message}`);
        }
    }

    printSummary() {
        console.log(`\n📊 SCRAPING SUMMARY:`);
        console.log(`Total jobs scraped: ${this.jobs.length}`);
        
        if (this.jobs.length > 0) {
            console.log(`\n📋 Sample job:`);
            const sampleJob = this.jobs[0];
            console.log(`Title: ${sampleJob.title}`);
            console.log(`Company: ${sampleJob.company}`);
            console.log(`Location: ${sampleJob.location}`);
            console.log(`Method: ${sampleJob.method}`);
        }
    }
}

// Usage function
async function scrapeGlassdoorAlternative() {
    const scraper = new AlternativeGlassdoorScraper();
    
    const searchTerm = 'Software Engineer';
    const location = 'San Francisco';
    
    try {
        console.log('🎯 GLASSDOOR SCRAPING - TRYING MULTIPLE METHODS');
        
        // Method 1: Direct scraping
        console.log('\n=== METHOD 1: DIRECT SCRAPING ===');
        await scraper.scrapeDirectly(searchTerm, location, 1);
        
        // Method 2: Mobile version (if direct fails)
        if (scraper.jobs.length === 0) {
            console.log('\n=== METHOD 2: MOBILE VERSION ===');
            await scraper.scrapeMobileVersion(searchTerm, location);
        }
        
        scraper.printSummary();
        await scraper.saveToFile();
        
        if (scraper.jobs.length === 0) {
            console.log('\n🚨 ALL METHODS FAILED. Consider these alternatives:');
            console.log('1. Use Puppeteer (install: npm install puppeteer)');
            console.log('2. Use a proxy service');
            console.log('3. Use Glassdoor API (requires approval)');
            console.log('4. Try other job sites (Indeed, LinkedIn)');
        }
        
    } catch (error) {
        console.error('❌ Scraping failed:', error.message);
    }
}

module.exports = { AlternativeGlassdoorScraper, scrapeGlassdoorAlternative };

if (require.main === module) {
    scrapeGlassdoorAlternative();
} 