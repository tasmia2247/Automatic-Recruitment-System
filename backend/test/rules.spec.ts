import { extractFromText } from '../src/candidates/cv-extractor';
import { screen } from '../src/screening/screening.engine';
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
