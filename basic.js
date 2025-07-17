const fs = require('fs');
const linkedIn = require('linkedin-jobs-api');

const queryOptions = {
    keyword: 'software engineer',
    location: 'India',
    dateSincePosted: 'past Week',
    jobType: 'full time',
    remoteFilter: 'remote',
    salary: '100000',
    experienceLevel: 'entry level',
    limit: '200',
    page: "0",
  };
  
  linkedIn.query(queryOptions).then(response => {
    console.log('API call successful! Saving response to JSON file...');
    
    // Convert response to JSON string with pretty formatting
    const jsonData = JSON.stringify(response, null, 2);
    
    // Save to file
    fs.writeFileSync('new.json', jsonData, 'utf8');
    
    console.log('Response saved to linkedin_jobs.json');
    console.log(`Found ${response.length} jobs`);
  }).catch(error => {
    console.error('Error fetching jobs:', error);
  });