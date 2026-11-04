import { extractFromText } from '../src/candidates/cv-extractor';
import { matchSubject, OpenJob } from '../src/candidates/subject-match';
import { screen, specializationCriteria, specializationItems } from '../src/screening/screening.engine';
import { computeVacancy } from '../src/common/scope';
import { validateForSubmit } from '../src/requisitions/requisitions.service';
import { render } from '../src/email/email.service';

const crit = (over: Partial<any>) => ({ id: 'c', label: 'x', field: 'cgpa', operator: 'gte', value: '3', mandatory: true, missingPolicy: 'REVIEW', ...over }) as any;

/** SRS 10.4 worked example: degree + CGPA >= 3.00 + 2 years experience. */
const CRITERIA = [
  crit({ id: '1', label: 'Relevant degree', field: 'degree', operator: 'contains_any', value: 'BSc, B.Sc, CSE, Computer' }),
  crit({ id: '2', label: 'CGPA', field: 'cgpa', operator: 'gte', value: '3.00' }),
  crit({ id: '3', label: 'Experience', field: 'totalExperienceYears', operator: 'gte', value: '2' }),
];

describe('screening engine (SRS 10.3)', () => {
  it('Candidate A passes all mandatory criteria', () => {
    const r = screen(CRITERIA, { degree: 'B.Sc in CSE', cgpa: 3.45, totalExperienceYears: 3 });
    expect(r.overall).toBe('Pass');
    expect(r.results.every((x) => x.outcome === 'Pass')).toBe(true);
  });

  it('Candidate B with confirmed CGPA 2.80 fails', () => {
    const r = screen(CRITERIA, { degree: 'BSc CSE', cgpa: 2.8, totalExperienceYears: 3 });
    expect(r.overall).toBe('Fail');
    expect(r.results[1].reason).toMatch(/not satisfied/);
  });

  it('Candidate C with no CGPA is Review Required, not Fail', () => {
    const r = screen(CRITERIA, { degree: 'BSc CSE', cgpa: null, totalExperienceYears: 3 });
    expect(r.overall).toBe('Review Required');
    expect(r.results[1].outcome).toBe('Missing');
  });

  it('a confirmed failure wins over missing data, and the missing field stays visible', () => {
    const r = screen(CRITERIA, { degree: 'BSc CSE', cgpa: null, totalExperienceYears: 1 });
    expect(r.overall).toBe('Fail');
    expect(r.results.map((x) => x.outcome)).toEqual(['Pass', 'Missing', 'Fail']);
  });

  it('preferred criteria never decide the outcome; FAIL missing-policy is honoured', () => {
    expect(screen([crit({ mandatory: false })], { cgpa: 1 }).overall).toBe('Pass');
    expect(screen([crit({ missingPolicy: 'FAIL' })], {}).overall).toBe('Fail');
    expect(screen([crit({ missingPolicy: 'IGNORE' })], {}).overall).toBe('Pass');
  });
});

describe('CV extraction never fabricates values (SRS 10.2)', () => {
  it('extracts fields that are present', () => {
    const ex = extractFromText(`Rahim Uddin
Email: rahim.uddin@example.com  Mobile: 01712-345678
B.Sc in Computer Science and Engineering, Daffodil International University
CGPA: 3.45 out of 4.00
Professional experience: 3 years of experience in software development
Skills: TypeScript, Node.js, PostgreSQL.
Expected Salary: 45,000 BDT`);
    expect(ex.name).toBe('Rahim Uddin');
    expect(ex.email).toBe('rahim.uddin@example.com');
    expect(ex.phone).toContain('01712');
    expect(ex.degree).toBe('B.Sc in Computer Science and Engineering');
    expect(ex.cgpa).toBe(3.45);
    expect(ex.totalExperienceYears).toBe(3);
    expect(ex.institution).toBe('Daffodil International University');
    expect(ex.skills).toMatch(/TypeScript/);
    expect(ex.expectedSalary).toMatch(/45,000/);
  });

  it('leaves missing fields null and does not normalise ambiguous GPA scales', () => {
    const ex = extractFromText('Karim\nHSC GPA 4.50 out of 5.00\n');
    expect(ex.email).toBeNull();
    expect(ex.totalExperienceYears).toBeNull();
    expect(ex.cgpaRaw).toMatch(/4\.50/);
    expect(ex.cgpa).toBeNull();
    expect(ex.age).toBeNull();
  });
});

describe('quota & form rules', () => {
  it('vacancy = quota - present, with flags instead of misleading numbers (SRS 5.2/5.5)', () => {
    expect(computeVacancy(20, 16)).toEqual({ value: 4, flag: null });
    expect(computeVacancy(null, 16).flag).toBe('Not available');
    expect(computeVacancy(5, 7).flag).toMatch(/Needs review/);
  });

  it('Replace Plan = Yes without employee/termination reference blocks submission (SRS 5.5 ex.2)', () => {
    const errs = validateForSubmit({ rank: 'Executive', headcount: 1, background: 'x', seatsAvailable: true, deadlineDays: 30, gender: 'Any',
      currentQuotaDept: 1, currentQuotaDesig: 1, presentManpowerDept: 0, presentManpowerDesig: 0, replacePlan: true } as any, []);
    expect(Object.keys(errs).sort()).toEqual(['replacementEmployeeName', 'terminationReference']);
  });

  it('email placeholders report missing values instead of sending blanks', () => {
    expect(render('Hi {{candidateName}} at {{location}}', { candidateName: 'A' })).toEqual({ out: 'Hi A at {{location}}', missing: ['location'] });
  });
});

describe('CV fields for the CV data Excel', () => {
  it('reads the last position and specialization only when they are written', () => {
    const ex = extractFromText('Karim Rahman\nkarim@example.com\n01811112222\nPosition Applied For: Manager\nDesignation: Sr. Network Engineer at Acme Ltd.\nOrganization Name: Acme Ltd.\nMSc in Computer Science, CGPA 3.70\nBBA in Marketing\n6 years of experience');
    expect(ex.lastPosition).toBe('Sr. Network Engineer');
    expect(ex.workplace).toBe('Acme Ltd.');
    expect(ex.specialization).toBe('Computer Science');
  });

  it('stops the last organization at the end of its line', () => {
    const ex = extractFromText('Nadia Sultana\nCompany Name: Ha-Meem Group\nBBA in Marketing, CGPA 3.55\n');
    expect(ex.workplace).toBe('Ha-Meem Group');
    expect(ex.specialization).toBe('Marketing');
  });

  it('leaves them empty instead of guessing', () => {
    const ex = extractFromText('Fresh Graduate\nfresh@example.com\nPosition Applied For: Trainee\nBSc\n');
    expect(ex.lastPosition).toBeNull();
    expect(ex.specialization).toBeNull();
    expect(ex).toMatchObject({ address: null, certifications: null, previousJobs: null });
  });

  it('reads the address, certifications and previous jobs when they are written', () => {
    const ex = extractFromText([
      'Tania Islam', 'tania@example.com', '01712000111',
      'Permanent Address: Village Kaliganj, Gazipur', 'Present Address: House 7, Road 3, Mirpur, Dhaka',
      'Work Experience', 'Designation: HR Executive', 'Company Name: Beta Apparels Ltd.', 'Designation: HR Assistant at Gamma Group',
      'Certifications', '• SHRM Certified Professional', '- Labour Law Training',
      'Education', 'MBA in Human Resource Management, CGPA 3.40',
    ].join('\n'));
    expect(ex.address).toBe('House 7, Road 3, Mirpur, Dhaka'); // the present address wins over the permanent one
    expect(ex.previousJobs).toBe('HR Executive, Beta Apparels Ltd.\nHR Assistant, Gamma Group');
    expect(ex.certifications).toBe('SHRM Certified Professional; Labour Law Training');
  });

  it('reads "Title at Company" lines under the experience heading', () => {
    const ex = extractFromText('Rafi Ahmed\nEmployment History\nSoftware Engineer at Delta Soft Ltd. (2021 - 2024)\nJunior Developer at Echo IT, 2019-2021\nSkills: Java\n');
    expect(ex.previousJobs).toBe('Software Engineer, Delta Soft Ltd.\nJunior Developer, Echo IT');
  });
});

describe('screening against the requisition "Specialization required"', () => {
  it('passes only when every item is written in the CV', () => {
    const c = specializationCriteria('BSc in CSE, full stack developer');
    expect(c.map((x) => x.value)).toEqual(['BSc in CSE', 'full stack developer']);
    expect(screen(c, { cvText: 'B.Sc. in CSE from DU. Worked as a Full-Stack Developer.' }).overall).toBe('Pass');
  });

  it('a missing item gives Review Required, never Fail', () => {
    const r = screen(specializationCriteria('BSc in CSE; Full stack developer'), { cvText: 'BSc in Computer Science and Engineering. Backend developer.' });
    expect(r.overall).toBe('Review Required');
    expect(r.results.map((x) => x.outcome)).toEqual(['Missing', 'Missing']);
    expect(r.results[0].reason).toBe('BSc in CSE: not found in CV - needs manual verification.');
    expect(screen(specializationCriteria('MBA'), { cvText: '' }).overall).toBe('Review Required');
  });

  it('matches whole words only and ignores empty items', () => {
    expect(specializationItems(' , HR ,,\nHR ')).toEqual(['HR']);
    expect(screen(specializationCriteria('HR'), { cvText: 'Three years in HRM and CHRO office' }).overall).toBe('Review Required');
    expect(screen(specializationCriteria('C++'), { cvText: 'Skills: C++, Python' }).overall).toBe('Pass');
    expect(specializationCriteria('')).toEqual([]);
  });
});

describe('mail subject matching', () => {
  const job = (over: Partial<OpenJob>): OpenJob => ({
    jobPostId: 'p', jobNo: 'JOB-2026-000001', title: 'Executive', emailSubject: null, vacancyId: 'v', vacancyNo: 'VAC-2026-000001',
    department: 'Administration', departmentCode: 'ADMIN', company: 'Ananta Jeanswear Ltd.', companyCode: 'AJL', ...over,
  });

  it('needs both the circular position and the department', () => {
    const jobs = [job({})];
    expect(matchSubject('Application for Executive - Administration', jobs).job).toBe(jobs[0]);
    expect(matchSubject('FWD: CV for executive, ADMIN dept', jobs).job).toBe(jobs[0]);
    expect(matchSubject('Application for Executive', jobs).job).toBeNull();
    expect(matchSubject('Application for Administration', jobs).job).toBeNull();
  });

  it('matches whole words only', () => {
    expect(matchSubject('Executive-Director of Administration studies', [job({ title: 'Director' })]).job).not.toBeNull();
    expect(matchSubject('Application for Executives in Administration', [job({})]).job).toBeNull();
  });

  it('takes the position out of a title that already names the department', () => {
    const jobs = [job({ title: 'Executive - Administration Department' })];
    expect(matchSubject('Application for Executive, Administration', jobs).job).toBe(jobs[0]);
  });

  it('accepts the custom subject printed on the circular', () => {
    const jobs = [job({ title: 'Officer', emailSubject: 'Factory Admin Role 2026' })];
    expect(matchSubject('Re: Factory Admin Role 2026 (JOB-2026-000001)', jobs).job).toBe(jobs[0]);
  });

  it('prefers the most specific position', () => {
    const jobs = [job({ jobNo: 'JOB-1' }), job({ jobNo: 'JOB-2', title: 'Sr. Executive' })];
    expect(matchSubject('Sr. Executive - Administration', jobs).job).toBe(jobs[1]);
    expect(matchSubject('Executive - Administration', jobs).job).toBe(jobs[0]);
  });

  it('uses company and Job ID only to separate identical jobs, and otherwise does not guess', () => {
    const jobs = [job({ jobNo: 'JOB-2026-000001' }), job({ jobNo: 'JOB-2026-000002', company: 'Paradise Washing Plant Limited', companyCode: 'PWPL' }), job({ jobNo: 'JOB-2026-000003', companyCode: 'PWPL', company: 'Paradise Washing Plant Limited' })];
    expect(matchSubject('Executive Administration AJL', jobs).job).toBe(jobs[0]);
    expect(matchSubject('Executive Administration PWPL (JOB-2026-000003)', jobs).job).toBe(jobs[2]);
    const none = matchSubject('Executive Administration PWPL', jobs);
    expect(none.job).toBeNull();
    expect(none.reason).toContain('fits 2 open jobs');
  });

  it('never matches an empty subject', () => {
    expect(matchSubject('', [job({})]).job).toBeNull();
    expect(matchSubject(null, [job({})]).job).toBeNull();
  });
});
