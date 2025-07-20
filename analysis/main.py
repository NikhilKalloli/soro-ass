import json
import os
import pandas as pd
import re
import matplotlib.pyplot as plt
import seaborn as sns
from collections import Counter

# --- Configuration ---
# TODO: Add your Gemini API Key here.
# It's recommended to use environment variables for security.
from dotenv import load_dotenv
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise ValueError("GEMINI_API_KEY not found in environment variables.")

import google.generativeai as genai
genai.configure(api_key=API_KEY)

# --- 1. Data Loading and Preparation ---

def load_and_prepare_data(json_path='analysis/part_1_enrich.json'):
    """Loads job data from JSON, prepares it for analysis."""
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"Error loading or parsing {json_path}: {e}")
        return pd.DataFrame()

    df = pd.json_normalize(data)

    # Combine skills and technologies into a single list
    # The 'get' method provides a default empty list if a key is missing
    df['skills'] = df.apply(
        lambda row: list(set(
            (row.get('from_description.required_skills', []) if isinstance(row.get('from_description.required_skills'), list) else []) +
            (row.get('from_description.technologies', []) if isinstance(row.get('from_description.technologies'), list) else [])
        )),
        axis=1
    )
    
    # Clean up the skills list by removing 'Not specified'
    df['skills'] = df['skills'].apply(lambda skills: [skill for skill in skills if skill and skill.lower() != 'not specified'])

    # Convert 'agoTime' (e.g., "1 day ago") to a numeric value for sorting
    df['days_ago'] = df['agoTime'].str.extract(r'(\d+)').astype(float).fillna(30) # Default to 30 for non-matches

    print("Data loaded and prepared successfully.")
    print(df[['position', 'company', 'days_ago', 'skills']].head())
    
    return df

# --- 2. Frequency Analysis ---

def analyze_top_skills(df, top_n=10):
    """Analyzes and visualizes the most frequent skills."""
    print("\n--- Step 2: Analyzing Top Skills ---")
    
    # Flatten the list of skills and count frequencies
    all_skills = [skill for sublist in df['skills'] for skill in sublist]
    skill_counts = Counter(all_skills)
    
    top_skills = skill_counts.most_common(top_n)
    
    if not top_skills:
        print("No skills found to analyze.")
        return pd.DataFrame()

    print(f"Top {top_n} most in-demand skills:")
    for skill, count in top_skills:
        print(f"- {skill}: {count} mentions")

    # Create DataFrame for visualization
    top_skills_df = pd.DataFrame(top_skills, columns=['Skill', 'Frequency'])
    
    # Visualization
    plt.figure(figsize=(12, 8))
    sns.barplot(x='Frequency', y='Skill', data=top_skills_df, palette='viridis')
    plt.title(f'Top {top_n} In-Demand Skills', fontsize=16)
    plt.xlabel('Frequency (Number of Mentions)', fontsize=12)
    plt.ylabel('Skill', fontsize=12)
    plt.tight_layout()
    
    # Save the plot
    output_path = 'analysis/top_skills.png'
    plt.savefig(output_path)
    print(f"Visualization saved to {output_path}")
    
    return top_skills_df

# --- 3. Trend Analysis with LLM Intelligence ---

def analyze_emerging_skills_with_llm(df, top_skills_list, recent_threshold_days=2, top_n=10):
    """
    Uses an LLM to identify emerging skills from recent job descriptions,
    comparing against a baseline of top skills.
    """
    print(f"\n--- Step 3: Analyzing Emerging Skills with LLM Intelligence (Recent <= {recent_threshold_days} days) ---")
    
    recent_df = df[df['days_ago'] <= recent_threshold_days]
    if recent_df.empty:
        print("No recent job postings found to analyze for emerging skills.")
        return pd.DataFrame()

    # Combine recent job descriptions into a single text block for the LLM
    recent_descriptions = "\n\n---\n\n".join(recent_df['job_description'].astype(str))
    
    model = genai.GenerativeModel('gemini-2.5-flash')
    
    prompt = f"""
    You are a senior technology and recruitment analyst. Your task is to identify truly "emerging" skills from the latest job postings.

    I have two sets of data for you:
    1.  **Baseline Top Skills**: This is a list of the most frequently mentioned skills across all job postings. These are the established, in-demand skills right now.
        ```
        {', '.join(top_skills_list)}
        ```

    2.  **Recent Job Descriptions**: This is the raw text from job descriptions posted in the last {recent_threshold_days} days.
        ```
        {recent_descriptions[:4000]} 
        ```

    **Your Analysis Task:**
    Read through the recent job descriptions. Compare them against the baseline top skills. Identify a list of up to {top_n} skills or technologies that represent a new or growing trend. These should be skills that are not yet on the top skills list, or that seem to be gaining significant momentum and represent the "next wave" of technology.

    Provide your answer ONLY as a JSON-formatted list of strings. For example: ["Quantum Computing", "Edge AI", "Rust Lang"].
    """

    print("Sending prompt to Gemini to identify emerging skills...")
    try:
        response = model.generate_content(prompt)
        # Clean up the response to extract the JSON part
        json_str = re.search(r'```json\n(.*)\n```', response.text, re.DOTALL)
        if not json_str:
            json_str = re.search(r'\[.*\]', response.text, re.DOTALL)
        
        if not json_str:
             raise ValueError("LLM did not return a valid JSON list.")

        emerging_skills_from_llm = json.loads(json_str.group(0))
        print("LLM identified emerging skills:", emerging_skills_from_llm)

    except (Exception, json.JSONDecodeError) as e:
        print(f"An error occurred during LLM analysis or parsing: {e}")
        print("Falling back to simple frequency analysis for emerging skills.")
        # Fallback to a simple analysis if LLM fails
        all_recent_skills = Counter([skill for sublist in recent_df['skills'] for skill in sublist])
        emerging_skills_from_llm = [skill for skill, count in all_recent_skills.most_common(top_n)]


    # Now, let's quantify and visualize these LLM-identified skills
    all_recent_skills = Counter([skill for sublist in recent_df['skills'] for skill in sublist])
    
    # Filter and count only the skills the LLM identified
    emerging_skill_counts = {skill: all_recent_skills[skill] for skill in emerging_skills_from_llm if skill in all_recent_skills}
    
    if not emerging_skill_counts:
        print("None of the LLM-identified skills were found in the recent job data for plotting.")
        return pd.DataFrame()

    emerging_skills_df = pd.DataFrame(list(emerging_skill_counts.items()), columns=['Skill', 'Recent Frequency']).sort_values(by='Recent Frequency', ascending=False)
        
    # Visualization for emerging skills
    plt.figure(figsize=(12, 8))
    sns.barplot(x='Recent Frequency', y='Skill', data=emerging_skills_df, palette='mako')
    plt.title(f'Top {len(emerging_skills_df)} LLM-Identified Emerging Skills', fontsize=16)
    plt.xlabel('Frequency in Recent Postings', fontsize=12)
    plt.ylabel('Skill', fontsize=12)
    plt.tight_layout()
    
    output_path = 'analysis/emerging_skills.png'
    plt.savefig(output_path)
    print(f"Emerging skills visualization saved to {output_path}")

    return emerging_skills_df

# --- 4. LLM-Powered Synthesis ---

def generate_and_save_report(top_skills_df, emerging_skills_df):
    """Uses Gemini to generate a report and saves it to a markdown file with embedded charts."""
    print("\n--- Step 4: Generating Comprehensive Report with Gemini ---")

    if top_skills_df.empty and emerging_skills_df.empty:
        print("No data to generate a report from.")
        return

    model = genai.GenerativeModel('gemini-2.5-flash')

    top_skills_list = top_skills_df.to_string(index=False)
    emerging_skills_list = emerging_skills_df.to_string(index=False) if not emerging_skills_df.empty else "None identified"

    company_profile = """
    **Main Focus:** A semiconductor company making special computer chips for AI systems, data centers, and networks, focusing on technology that processes and moves data very fast.
    **Target Markets:** Data centers (AI/cloud), Automotive (smart cars), Enterprise Networking, and Carrier Infrastructure (5G networks).
    **Company Goal:** To accelerate AI and data infrastructure, enabling customers to build optimized, custom silicon solutions.
    **Key Strengths:** Expertise in custom silicon, reliable execution, and deep customer partnerships. A focus on power-efficient, high-performance systems.
    **Special Products:** Silicon solutions for AI computing, networking, and storage, including specialized chips for the automotive market.
    **Work Style:** Emphasizes close, shoulder-to-shoulder collaboration with customers.
    """

    prompt = f"""
    You are a People Analytics expert preparing a strategic report for the leadership of a leading semiconductor company.

    ---
    **COMPANY PROFILE:**
    {company_profile}
    ---

    Your analysis is based on two key visualizations derived from recent job market data:
    1.  **Top In-Demand Skills Chart (`top_skills.png`)**: This shows the most frequently mentioned skills, indicating core competencies in the industry.
    2.  **Emerging Skills Chart (`emerging_skills.png`)**: This highlights skills trending in the most recent job postings, pointing to future needs.

    Here is the data that populates those charts:

    **Top 10 In-Demand Skills Data:**
    ```
    {top_skills_list}
    ```

    **Top 10 Emerging Skills Data:**
    ```
    {emerging_skills_list}
    ```

    **Your Task:**
    Write a comprehensive analysis in markdown format. Your report must:
    1.  Start with a brief **Executive Summary**.
    2.  Provide **Key Insights from the 'Top In-Demand Skills' chart**.
    3.  Provide **Key Insights from the 'Emerging Skills' chart**.
    4.  Conclude with a set of **Actionable Recommendations**. These recommendations must be **specifically tailored to the company profile provided**. They should advise on how to leverage the skill trends to strengthen their position in their target markets (Data Center, Automotive, Enterprise, Carrier) and achieve their strategic goals.

    Please generate only the text for the report. The final markdown file will embed the images.
    """

    print("Sending prompt to Gemini...")
    try:
        response = model.generate_content(prompt)
        report_text = response.text
        print("\n--- Gemini Analysis Report (Text-Only) ---")
        print(report_text)
        print("-------------------------------------------\n")

        # Construct the final markdown file with embedded images
        final_report_content = f"""
# Job Market Skills Analysis

## Executive Summary
{report_text.split("Key Insights")[0].split("Executive Summary")[-1].strip()}

## Top In-Demand Skills
![Top In-Demand Skills](top_skills.png)

### Key Insights from the 'Top In-Demand Skills' Chart
{"Key Insights" + report_text.split("Key Insights")[1].split("Actionable Recommendations")[0].strip()}

## Emerging Skills
![Emerging Skills](emerging_skills.png)

### Key Insights from the 'Emerging Skills' Chart
{report_text.split("Key Insights from the 'Emerging Skills' chart")[-1].split("Actionable Recommendations")[0].strip()}

## Actionable Recommendations
{"Actionable Recommendations" + report_text.split("Actionable Recommendations")[-1].strip()}
"""

        report_path = 'analysis/insights_report.md'
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(final_report_content)
        print(f"Comprehensive markdown report saved to {report_path}")

    except Exception as e:
        print(f"An error occurred while calling the Gemini API: {e}")

def main():
    """Main function to run the analysis pipeline."""
    df = load_and_prepare_data()
    if df.empty:
        return

    # Step 2: Frequency Analysis
    top_skills_df = analyze_top_skills(df)
    
    # Step 3: Trend Analysis with LLM
    emerging_skills_df = analyze_emerging_skills_with_llm(df, top_skills_df['Skill'].tolist(), recent_threshold_days=2)

    # Step 4: LLM-Powered Synthesis and Report Generation
    if not top_skills_df.empty:
        generate_and_save_report(top_skills_df, emerging_skills_df)


if __name__ == '__main__':
    main()
