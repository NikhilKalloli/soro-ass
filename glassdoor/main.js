const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

class GlassdoorScraper {
    constructor() {
        this.jobs = [];
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0'
        };
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async scrapeJobListings(searchTerm, location, pages = 1) {
        console.log(`🔍 Scraping Glassdoor jobs for: "${searchTerm}" in "${location}"`);
        
        for (let page = 1; page <= pages; page++) {
            try {
                console.log(`\n📄 Scraping page ${page}...`);
                
                // Glassdoor search URL
                const searchUrl = `https://www.glassdoor.com/Job/jobs.htm?suggestCount=0&suggestChosen=false&clickSource=searchBtn&typedKeyword=${encodeURIComponent(searchTerm)}&sc.keyword=${encodeURIComponent(searchTerm)}&locT=C&locId=1147401&jobType=&context=Jobs&p=${page}`;
                
                const response = await axios.get(searchUrl, {
                    headers: this.headers,
                    timeout: 15000
                });

                const $ = cheerio.load(response.data);
                
                // Find job listing containers
                const jobElements = $('[data-test="job-listing"]').length > 0 
                    ? $('[data-test="job-listing"]')
                    : $('.react-job-listing, .jobContainer, .job-search-key-*, [data-id*="job"]').slice(0, 20);

                if (jobElements.length === 0) {
                    console.log('⚠️  No job listings found on this page. The page structure might have changed.');
                    break;
                }

                console.log(`Found ${jobElements.length} job listings on page ${page}`);

                for (let i = 0; i < jobElements.length; i++) {
                    const jobElement = $(jobElements[i]);
                    
                    try {
                        const job = await this.extractJobData($, jobElement);
                        if (job.title && job.company) {
                            this.jobs.push(job);
                            console.log(`✅ Extracted: ${job.title} at ${job.company}`);
                        }
                    } catch (error) {
                        console.log(`❌ Error extracting job ${i + 1}: ${error.message}`);
                    }
                }

                // Add delay between pages
                if (page < pages) {
                    console.log('⏳ Waiting before next page...');
                    await this.delay(3000 + Math.random() * 2000);
                }

            } catch (error) {
                console.error(`❌ Error scraping page ${page}: ${error.message}`);
                if (error.response?.status === 429) {
                    console.log('⚠️  Rate limited. Waiting longer...');
                    await this.delay(10000);
                }
            }
        }

        return this.jobs;
    }

    async extractJobData($, jobElement) {
        // Multiple selectors to try for each field
        const selectors = {
            title: [
                '[data-test="job-title"]',
                '.jobTitle a',
                '.job-title',
                'h3 a',
                '.JobCard_jobTitle__*',
                '.jobInfoItem .jobTitle'
            ],
            company: [
                '[data-test="employer-name"]',
                '.employerName',
                '.employer-name',
                '.company',
                '.JobCard_employerName__*'
            ],
            location: [
                '[data-test="job-location"]',
                '.location',
                '.loc',
                '.jobLocation',
                '.JobCard_location__*'
            ],
            jobUrl: [
                '[data-test="job-title"] a',
                '.jobTitle a',
                '.job-title a',
                'h3 a'
            ]
        };

        const job = {};

        // Extract basic info
        for (const [field, selectorArray] of Object.entries(selectors)) {
            for (const selector of selectorArray) {
                const element = jobElement.find(selector).first();
                if (element.length > 0) {
                    if (field === 'jobUrl') {
                        let href = element.attr('href');
                        if (href) {
                            job[field] = href.startsWith('http') ? href : `https://www.glassdoor.com${href}`;
                            break;
                        }
                    } else {
                        const text = element.text().trim();
                        if (text) {
                            job[field] = text;
                            break;
                        }
                    }
                }
            }
        }

        // Try to extract job description from the listing page
        if (job.jobUrl) {
            job.job_description = await this.extractJobDescription(job.jobUrl);
        } else {
            job.job_description = 'Job description not available';
        }

        return {
            title: job.title || 'N/A',
            company: job.company || 'N/A',
            location: job.location || 'N/A',
            job_description: job.job_description || 'N/A',
            jobUrl: job.jobUrl || 'N/A',
            scraped_at: new Date().toISOString()
        };
    }

    async extractJobDescription(jobUrl) {
        try {
            console.log(`  📝 Fetching job description from: ${jobUrl}`);
            
            await this.delay(1000 + Math.random() * 1000); // Random delay
            
            const response = await axios.get(jobUrl, {
                headers: this.headers,
                timeout: 10000
            });
            
            const $ = cheerio.load(response.data);
            
            // Multiple selectors for job description
            const descriptionSelectors = [
                '[data-test="jobDescriptionText"]',
                '.jobDescriptionContent',
                '.desc',
                '.jobDescription',
                '.job-description',
                '#JobDescContainer',
                '.jobsearch-jobDescriptionText'
            ];
            
            let jobDescription = '';
            
            for (const selector of descriptionSelectors) {
                const element = $(selector);
                if (element.length > 0) {
                    jobDescription = element.text().trim();
                    if (jobDescription && jobDescription.length > 100) {
                        break;
                    }
                }
            }
            
            // If no description found, try to get any meaningful content
            if (!jobDescription || jobDescription.length < 50) {
                const allText = $('body').text();
                const descIndex = allText.toLowerCase().search(/(job description|about|overview|responsibilities)/);
                if (descIndex !== -1) {
                    jobDescription = allText.substring(descIndex, descIndex + 2000).trim();
                }
            }
            
            return jobDescription.length > 50 ? jobDescription : 'Job description not found';
            
        } catch (error) {
            console.error(`    ❌ Error fetching job description: ${error.message}`);
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

    printSummary() {
        console.log(`\n📊 SCRAPING SUMMARY:`);
        console.log(`Total jobs scraped: ${this.jobs.length}`);
        console.log(`Jobs with descriptions: ${this.jobs.filter(job => job.job_description && job.job_description !== 'N/A' && job.job_description !== 'Job description not found').length}`);
        
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
async function scrapeGlassdoorJobs() {
    const scraper = new GlassdoorScraper();
    
    // Configuration
    const searchTerm = 'Software Engineer'; // Change this to your desired job title
    const location = 'San Francisco'; // Change this to your desired location
    const pages = 2; // Number of pages to scrape
    
    try {
        await scraper.scrapeJobListings(searchTerm, location, pages);
        scraper.printSummary();
        await scraper.saveToFile();
        
        console.log('\n🎉 Scraping completed successfully!');
        
    } catch (error) {
        console.error('❌ Scraping failed:', error.message);
    }
}

// Export for use in other files
module.exports = { GlassdoorScraper, scrapeGlassdoorJobs };

// Run if called directly
if (require.main === module) {
    scrapeGlassdoorJobs();
}
