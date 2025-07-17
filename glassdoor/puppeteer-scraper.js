const puppeteer = require('puppeteer');
const fs = require('fs');

class GlassdoorPuppeteerScraper {
    constructor() {
        this.jobs = [];
        this.browser = null;
        this.page = null;
    }

    async init() {
        console.log('🚀 Starting browser...');
        this.browser = await puppeteer.launch({
            headless: false, // Set to true to run in background
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        });
        
        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1920, height: 1080 });
        
        // Set user agent to look like a real browser
        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    }

    async scrapeJobListings(searchTerm, location, maxJobs = 20) {
        try {
            console.log(`🔍 Scraping Glassdoor jobs for: "${searchTerm}" in "${location}"`);
            
            // Navigate to Glassdoor
            await this.page.goto('https://www.glassdoor.com/Job/jobs.htm', { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Wait a bit and handle any popups
            await this.page.waitForTimeout(3000);
            
            // Try to close any popups/modals
            try {
                await this.page.click('[data-test="modal-close"], .modal-close, .CloseIcon', { timeout: 3000 });
                await this.page.waitForTimeout(1000);
            } catch (e) {
                console.log('No modal to close');
            }

            // Fill in search form
            console.log('📝 Filling search form...');
            
            // Job title search
            await this.page.waitForSelector('input[data-test="job-search-bar-keywords"], input[placeholder*="Job title"], #searchBar-jobTitle', { timeout: 10000 });
            await this.page.type('input[data-test="job-search-bar-keywords"], input[placeholder*="Job title"], #searchBar-jobTitle', searchTerm);
            
            // Location search
            await this.page.waitForSelector('input[data-test="job-search-bar-location"], input[placeholder*="Location"], #searchBar-location', { timeout: 10000 });
            await this.page.click('input[data-test="job-search-bar-location"], input[placeholder*="Location"], #searchBar-location', { clickCount: 3 });
            await this.page.type('input[data-test="job-search-bar-location"], input[placeholder*="Location"], #searchBar-location', location);
            
            await this.page.waitForTimeout(1000);
            
            // Submit search
            await this.page.click('button[data-test="job-search-button"], button[type="submit"], .SearchButton');
            await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
            
            console.log('✅ Search submitted, waiting for results...');
            await this.page.waitForTimeout(5000);

            // Scrape job listings
            let jobCount = 0;
            let pageNum = 1;
            
            while (jobCount < maxJobs) {
                console.log(`\n📄 Scraping page ${pageNum}...`);
                
                // Wait for job listings to load
                await this.page.waitForSelector('[data-test="job-listing"], .react-job-listing, .jobContainer', { timeout: 15000 });
                
                // Get all job listings on current page
                const jobElements = await this.page.$$('[data-test="job-listing"], .react-job-listing, .jobContainer');
                
                if (jobElements.length === 0) {
                    console.log('❌ No more job listings found');
                    break;
                }
                
                console.log(`Found ${jobElements.length} jobs on page ${pageNum}`);
                
                // Extract data from each job
                for (let i = 0; i < jobElements.length && jobCount < maxJobs; i++) {
                    try {
                        const job = await this.extractJobData(jobElements[i]);
                        if (job && job.title && job.company) {
                            this.jobs.push(job);
                            jobCount++;
                            console.log(`✅ [${jobCount}] ${job.title} at ${job.company}`);
                        }
                    } catch (error) {
                        console.log(`❌ Error extracting job ${i + 1}: ${error.message}`);
                    }
                }
                
                // Try to go to next page
                if (jobCount < maxJobs) {
                    try {
                        const nextButton = await this.page.$('[data-test="pagination-next"], .nextButton, [aria-label="Next"]');
                        if (nextButton) {
                            await nextButton.click();
                            await this.page.waitForTimeout(3000);
                            await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
                            pageNum++;
                        } else {
                            console.log('📄 No more pages available');
                            break;
                        }
                    } catch (error) {
                        console.log('📄 Could not navigate to next page');
                        break;
                    }
                }
            }
            
            console.log(`\n🎉 Scraping completed! Found ${this.jobs.length} jobs`);
            return this.jobs;
            
        } catch (error) {
            console.error(`❌ Scraping failed: ${error.message}`);
            throw error;
        }
    }

    async extractJobData(jobElement) {
        try {
            // Extract job details using page.evaluate
            const jobData = await this.page.evaluate((element) => {
                const getTextBySelectors = (selectors) => {
                    for (const selector of selectors) {
                        const el = element.querySelector(selector);
                        if (el && el.textContent.trim()) {
                            return el.textContent.trim();
                        }
                    }
                    return null;
                };
                
                const getHrefBySelectors = (selectors) => {
                    for (const selector of selectors) {
                        const el = element.querySelector(selector);
                        if (el && el.href) {
                            return el.href;
                        }
                    }
                    return null;
                };
                
                const title = getTextBySelectors([
                    '[data-test="job-title"]',
                    '.jobTitle a',
                    '.job-title',
                    'h3 a',
                    '.JobCard_jobTitle__*'
                ]);
                
                const company = getTextBySelectors([
                    '[data-test="employer-name"]',
                    '.employerName',
                    '.employer-name',
                    '.company',
                    '.JobCard_employerName__*'
                ]);
                
                const location = getTextBySelectors([
                    '[data-test="job-location"]',
                    '.location',
                    '.loc',
                    '.jobLocation',
                    '.JobCard_location__*'
                ]);
                
                const jobUrl = getHrefBySelectors([
                    '[data-test="job-title"] a',
                    '.jobTitle a',
                    '.job-title a',
                    'h3 a'
                ]);
                
                return { title, company, location, jobUrl };
            }, jobElement);
            
            // Get job description by clicking on the job
            let jobDescription = 'Job description not available';
            if (jobData.jobUrl) {
                try {
                    jobDescription = await this.getJobDescription(jobData.jobUrl);
                } catch (error) {
                    console.log(`    ⚠️  Could not get description: ${error.message}`);
                }
            }
            
            return {
                title: jobData.title || 'N/A',
                company: jobData.company || 'N/A',
                location: jobData.location || 'N/A',
                job_description: jobDescription,
                jobUrl: jobData.jobUrl || 'N/A',
                scraped_at: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`Error extracting job data: ${error.message}`);
            return null;
        }
    }

    async getJobDescription(jobUrl) {
        try {
            // Open job in new tab
            const newPage = await this.browser.newPage();
            await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            await newPage.goto(jobUrl, { waitUntil: 'networkidle2', timeout: 15000 });
            await newPage.waitForTimeout(2000);
            
            // Extract job description
            const description = await newPage.evaluate(() => {
                const selectors = [
                    '[data-test="jobDescriptionText"]',
                    '.jobDescriptionContent',
                    '.desc',
                    '.jobDescription',
                    '.job-description',
                    '#JobDescContainer'
                ];
                
                for (const selector of selectors) {
                    const element = document.querySelector(selector);
                    if (element && element.textContent.trim().length > 50) {
                        return element.textContent.trim();
                    }
                }
                
                return 'Job description not found';
            });
            
            await newPage.close();
            return description;
            
        } catch (error) {
            console.error(`Error getting job description: ${error.message}`);
            return 'Error fetching job description';
        }
    }

    async saveToFile(filename = 'glassdoor_jobs.json') {
        try {
            fs.writeFileSync(filename, JSON.stringify(this.jobs, null, 2), 'utf8');
            console.log(`\n💾 Saved ${this.jobs.length} jobs to ${filename}`);
        } catch (error) {
            console.error(`❌ Error saving to file: ${error.message}`);
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            console.log('🔒 Browser closed');
        }
    }

    printSummary() {
        console.log(`\n📊 SCRAPING SUMMARY:`);
        console.log(`Total jobs scraped: ${this.jobs.length}`);
        console.log(`Jobs with descriptions: ${this.jobs.filter(job => 
            job.job_description && 
            job.job_description !== 'N/A' && 
            job.job_description !== 'Job description not found'
        ).length}`);
        
        if (this.jobs.length > 0) {
            console.log(`\n📋 Sample job:`);
            const sampleJob = this.jobs[0];
            console.log(`Title: ${sampleJob.title}`);
            console.log(`Company: ${sampleJob.company}`);
            console.log(`Location: ${sampleJob.location}`);
            console.log(`Description: ${sampleJob.job_description.substring(0, 100)}...`);
        }
    }
}

// Usage function
async function scrapeGlassdoorWithPuppeteer() {
    const scraper = new GlassdoorPuppeteerScraper();
    
    try {
        await scraper.init();
        
        // Configuration
        const searchTerm = 'Software Engineer';
        const location = 'San Francisco, CA';
        const maxJobs = 10;
        
        await scraper.scrapeJobListings(searchTerm, location, maxJobs);
        scraper.printSummary();
        await scraper.saveToFile();
        
    } catch (error) {
        console.error('❌ Scraping failed:', error.message);
    } finally {
        await scraper.close();
    }
}

// Export for use in other files
module.exports = { GlassdoorPuppeteerScraper, scrapeGlassdoorWithPuppeteer };

// Run if called directly
if (require.main === module) {
    scrapeGlassdoorWithPuppeteer();
} 