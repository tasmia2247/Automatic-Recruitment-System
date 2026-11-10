import { extractFromText } from '../src/candidates/cv-extractor';
import { indexCv, keywordsOf, matchLine, requirementLines } from '../src/screening/keywords';
import { normalizeForMatch, PASS_MARK, requirementSummary, screenRequirements } from '../src/screening/screening.engine';

// The ICT Executive post the owner sent (2026-11-08): Key Responsibilities and Required Skills & Qualifications, as on the circular.
const DUTIES = `• Assist in developing and maintaining internal software applications and ICT solutions.
• Provide technical support to internal users and troubleshoot software/hardware/network issues.
• Support installation, configuration, and maintenance of IT systems and network infrastructure.
• Maintain proper documentation of IT assets, configurations, and support activities.
• Perform other ICT-related tasks assigned by the department.`;
const SKILLS = `Bachelor's degree in Computer Science, Software Engineering, or a related field.
Basic knowledge of programming, networking, and IT infrastructure.
Good analytical and problem-solving skills.
Strong communication and teamwork skills.
Willingness to learn and work in a fast-paced environment.`;
const IT_CV = {
  degree: 'BSc', specialization: 'Computer Science and Engineering', education: 'BSc, Computer Science and Engineering - DIU (3.4 out of 4, 2021)', totalExperienceYears: 2,
  cvText: `IT Support Engineer, XYZ Ltd (2022-2024). Provided technical support to 200 users, troubleshooting hardware, software and network problems.
Installed and configured Windows servers, LAN/WAN network infrastructure and ICT equipment. Kept documentation of IT assets and system configurations.
Developed small internal software applications in C# and Python (programming). Analytical thinker; problem solving; good communication and team work.
Education: BSc in Computer Science and Engineering, Daffodil International University.`,
};
const SALES_CV = {
  degree: 'BBA', specialization: 'Marketing', education: 'BBA, Marketing - NSU (2019)', totalExperienceYears: 5,
  cvText: 'Sales Executive at ABC Garments. Handled buyers, sales targets and market visits. Good communication skills. MS Office.',
};
const posting = { requiredEducation: 'BSc in Computer Science\nBSc in Software Engineering', requiredExperienceYears: 1, requiredSkills: SKILLS, jobDescription: DUTIES };

describe('keyword match score (owner, 2026-11-08)', () => {
  it('reads requirement lines: bullets stripped, short comma lists split, sentences kept whole', () => {
    expect(requirementLines(DUTIES)).toHaveLength(5);
    expect(requirementLines(DUTIES)[0]).toBe('Assist in developing and maintaining internal software applications and ICT solutions');
    expect(requirementLines('MS Excel, AutoCAD, Power BI\n1. SQL')).toEqual(['MS Excel', 'AutoCAD', 'Power BI', 'SQL']);
    expect(requirementLines('Basic knowledge of programming, networking, and IT infrastructure.')).toEqual(['Basic knowledge of programming, networking, and IT infrastructure']);
  });

  it('keeps the specific words of a line and drops filler', () => {
    expect(keywordsOf('Basic knowledge of programming, networking, and IT infrastructure')).toEqual(['programming', 'networking', 'IT', 'infrastructure']);
    expect(keywordsOf("Bachelor's degree in Computer Science, Software Engineering, or a related field")).toEqual(['computer', 'science', 'software', 'engineering']);
    expect(keywordsOf('Willingness to learn and work in a fast-paced environment')).toEqual([]);
  });

  it('matches word forms but not unrelated words that merely start alike', () => {
    const cv = indexCv('Troubleshooting networks; program design; soft skills; team work; it is', '');
    const has = (item: string) => matchLine(item, cv, normalizeForMatch)!.found;
    expect(has('troubleshoot network')).toEqual(['troubleshoot', 'network']);
    expect(has('programming')).toEqual(['programming']);
    expect(has('software')).toEqual([]); // "soft" is not "software"
    expect(has('designation')).toEqual([]); // "design" is not "designation"
    expect(has('teamwork')).toEqual(['teamwork']); // written apart in the CV
    expect(has('IT support')).toEqual([]); // "it" in lower case is not IT
  });

  it('scores a matching CV high and passes it; a CV from another field scores low and goes to review, never Fail', () => {
    const it = screenRequirements(posting, IT_CV as any)!;
    expect(it.score).toBeGreaterThanOrEqual(PASS_MARK);
    expect(it.overall).toBe('Pass');
    expect(it.scoreParts!.parts.map((p) => [p.key, p.weight])).toEqual([['skills', 50], ['responsibilities', 30], ['education', 10], ['experience', 10]]);
    expect(it.results[0]).toMatchObject({ criterionId: 'match-score', outcome: 'Pass' });
    expect(it.results.filter((r) => r.operator === 'keywords')).toHaveLength(9); // the "willingness" line has nothing to look for

    const sales = screenRequirements(posting, SALES_CV as any)!;
    expect(sales.score).toBeLessThan(40);
    expect(sales.overall).toBe('Review Required');
    expect(sales.results[0].reason).toMatch(/^Match score [\d.]+% is below the pass mark of 70%/);
  });

  it('a high score still needs the education, experience and other requirements', () => {
    const r = screenRequirements({ ...posting, requiredExperienceYears: 5, specialization: 'CCNA' }, IT_CV as any)!;
    expect(r.overall).toBe('Review Required');
    expect(r.results.filter((x) => x.mandatory && x.outcome !== 'Pass').map((x) => x.criterionId)).toEqual(['experience', 'specialization-1']);
  });

  it('leaves out parts that are not set and scales the rest to 100', () => {
    const r = screenRequirements({ requiredSkills: 'MS Excel, AutoCAD' }, { cvText: 'Skills: MS Excel' })!;
    expect(r.scoreParts!.parts).toEqual([{ key: 'skills', label: 'Required Skills', weight: 100, earned: 0.5 }]);
    expect(r.score).toBe(50);
    expect(screenRequirements({}, { cvText: 'x' })).toBeNull();
    expect(screenRequirements({ specialization: 'Knit' }, { cvText: 'knit' })).toMatchObject({ overall: 'Pass', score: null });
  });

  it('knows common subject abbreviations both ways (HRM, CSE, AIS ...), and a subject written into "PGDHRM"', () => {
    const hrm = { degree: 'MBA', specialization: 'HRM', education: 'MBA, HRM - Alpha University (2019)' };
    expect(screenRequirements({ requiredEducation: 'MBA in Human Resource Management' }, hrm as any)!.overall).toBe('Pass');
    const full = { degree: 'BSc', specialization: 'Computer Science & Engineering', education: 'BSc, Computer Science & Engineering - Beta University' };
    expect(screenRequirements({ requiredEducation: 'BSc in CSE' }, full as any)!.overall).toBe('Pass');
    expect(screenRequirements({ requiredEducation: 'BSc in EEE' }, full as any)!.overall).toBe('Review Required');
    const pgd = extractFromText(['Rafi Ahmed', 'EDUCATION', '• PGDHRM under AIUB 2025, CGPA- 3.41', '• MBA in Management -2018, CGPA- 2.94'].join('\n'));
    expect(pgd.education).toContain('PGDHRM, HRM - AIUB');
    expect(screenRequirements({ requiredEducation: 'PGD in HRM' }, { degree: pgd.degree, specialization: pgd.specialization, education: pgd.education })!.overall).toBe('Pass');
  });

  it('summarises what a vacancy is checked against', () => {
    expect(requirementSummary(posting)).toEqual([
      'Education: BSc in Computer Science or BSc in Software Engineering', 'Experience: at least 1 year', 'Required Skills (5 points)', 'Key Responsibilities (5 points)', 'match score at least 70%',
    ]);
  });
});
