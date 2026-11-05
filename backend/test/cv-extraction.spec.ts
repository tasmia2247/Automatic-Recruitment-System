import { extractFromText } from '../src/candidates/cv-extractor';
import { layoutPdf, PdfItem } from '../src/candidates/pdf-layout';

// Made-up people in the layouts of real CVs that came in (Bdjobs export, two-column designs, labelled HR CVs).
// Real CVs are personal data and are not kept in the repository.
const TODAY = new Date(Date.UTC(2026, 10, 5));

describe('CV extraction: Bdjobs export', () => {
  const cv = [
    'Source: Bdjobs.com Online Talent Search',
    'Job Title: Manager - QC (RMG Washing Plant)',
    'Last Updated: 4 Feb 2026',
    'MD. KAMAL HOSSAIN',
    'Ward -08 Boat mill, Shafipur, Kaliakair,',
    'Gazipur 1751',
    '01711000111, 01811000222',
    'kamal.h@example.com',
    'Career Summary:',
    'Over 11 years of hands on experience in cutting section operations.',
    'Employment History:',
    'Total year of experience: 19.9 yrs',
    '1. Deputy Manager (9.1yrs)',
    '(5 Oct 2017 - Continuing)',
    'Delta Textile (BD) Ltd.',
    'Area of Expertise:',
    'Quality Management (8.3 yr)',
    'Duties/Responsibilities',
    'Decision Maker',
    '2. Supervisor To In-charge (7.0yrs)',
    '(10 Oct 2010 - 21 Sep 2017)',
    'Echo Washing Plant',
    'Area of Expertise:',
    'Communication (4.3 yr), Analytical Skill (4.7 yr)',
    'Academic Qualification:',
    'Exam Title: PGD | Concentration/Major: Textile Industry Management | Institute: Bangladesh University of Textiles | Result: Enrolled | Pass.Year: 2027',
    'Exam Title: Bachelor of Science (BSc) | Concentration/Major: Textile Engineering | Institute: University of South Asia | Result: CGPA : 2.68 (out of 4) | Pass.Year: 2017 | Duration: 04 Years',
    'Exam Title: HSC | Concentration/Major: Science | Institute: BCIC College, Dhaka | Result: CGPA : 3.4 (out of 5) | Pass.Year: 2008',
    'Training Summary:',
    'Training Title: Cutting Team Leadership | Topic: Leadership | Institute: New Asia Group | Country: Bangladesh | Year: 2023 | Duration: 01Month',
    'Professional Qualification:',
    'Certification: SROMIC SIKKA COURSE | Institute: Ministry of Labour and Employment | Location: Dhaka | From: May 18, 2024 | To: May 23, 2024',
    'Career and Application Information:',
    'Present Salary : 75000',
    'Expected Salary : 90000',
    'Skills:',
    'Fields of Skill\tDescription',
    '• Textile quality management\t<p>Textile Testing </p><p>Physical &amp;',
    '• Internal Audit\tChemical Testing</',
    'Personal Details:',
    "Father's Name : Abdus Samad",
    "Mother's Name : Amena Begum",
    'Date of Birth : 1 Jan 1985',
    'Permanent Address : Charishimul, Dhanbari, Tangail',
    'Reference (s):',
    'Name : Md Noyon Hossain',
    'Organization : NRN GROUP',
    'Designation : AGM Production',
    'Primary Mobile No : 01637000000',
    'Primary Email : referee@example.com',
  ].join('\n');
  const ex = extractFromText(cv, { today: TODAY });

  it('takes the candidate, not the father or the referee', () => {
    expect(ex.name).toBe('MD. KAMAL HOSSAIN');
    expect(ex.email).toBe('kamal.h@example.com');
    expect(ex.phone).toBe('01711000111');
    expect(ex.address).toBe('Ward -08 Boat mill, Shafipur, Kaliakair, Gazipur 1751');
    expect(ex.age).toBe(41);
    expect(ex.expectedSalary).toBe('90000');
  });

  it('reads the jobs held, not the post applied for or the referee', () => {
    expect(ex.totalExperienceYears).toBe(19.9); // the stated total, not "over 11 years" in the summary
    expect(ex.lastPosition).toBe('Deputy Manager');
    expect(ex.workplace).toBe('Delta Textile (BD) Ltd.');
    expect(ex.previousJobs).toBe('Deputy Manager, Delta Textile (BD) Ltd.\nSupervisor To In-charge, Echo Washing Plant');
  });

  it('reads the highest finished degree with its own subject, institute and CGPA', () => {
    expect(ex.degree).toBe('Bachelor of Science (BSc)'); // the enrolled PGD does not count yet
    expect(ex.specialization).toBe('Textile Engineering');
    expect(ex.institution).toBe('University of South Asia');
    expect(ex.cgpa).toBe(2.68);
    expect(ex.cgpaRaw).toBe('CGPA : 2.68 (out of 4)');
    expect(ex.education).toContain('HSC, Science - BCIC College, Dhaka');
  });

  it('reads skills, expertise and trainings without the HTML description', () => {
    expect(ex.skills).toBe('Textile quality management, Internal Audit, Quality Management, Communication, Analytical Skill');
    expect(ex.certifications).toBe('Cutting Team Leadership (New Asia Group, 2023); SROMIC SIKKA COURSE (Ministry of Labour and Employment, 2024)');
  });

  it('does not turn a GPA out of 5 into a CGPA', () => {
    const hsc = extractFromText('Rina Akter\nAcademic Qualification:\nExam Title: HSC | Concentration/Major: Science | Institute: BCIC College | Result: CGPA : 3.4 (out of 5) | Pass.Year: 2008');
    expect(hsc.degree).toBe('HSC');
    expect(hsc.cgpaRaw).toBe('CGPA : 3.4 (out of 5)');
    expect(hsc.cgpa).toBeNull();
  });
});

describe('CV extraction: designed CVs', () => {
  it('reads a sidebar CV whose jobs are written as company / group / title under a date', () => {
    const ex = extractFromText([
      'CONTACT ME', '+8801892-000111', 'rafiq.ahmed@example.com', 'Auchpara,Tongi,Gazipur',
      'SKILLS', 'Microsoft Office', 'Time Management',
      'TRAINING', 'Firefighting, Fire Prevention,', 'Rescue and First Aider Training.', 'Social Compliance &', 'Environmental Management', '(SICIP-BGMEA)',
      'REFERENCES', 'Abu Rayhan', 'AGM Admin', 'Phone: +8801788-000000',
      'RAFIQ AHMED', 'Administrative Officer',
      'EXPERIENCE', 'Creative Wash Ltd - 01\t2022-Till Now', 'Ha-Meem Group', 'Administrative Officer',
      'Denitex Wash Ltd\t2021-2022', 'Armana Group', 'Administrative Officer',
      'EDUCATION', 'Bachelor of Arts (Honours), English', 'Uttara Town College', 'CGPA 2.53 / 4.00',
      'Higher Secondary Certificate (HSC), Science', 'Gulshan Model High School & College', 'GPA 3.92 / 5.00',
    ].join('\n'), { nameHint: 'RAFIQ AHMED' });
    expect(ex).toMatchObject({
      name: 'RAFIQ AHMED', phone: '01892000111', address: 'Auchpara,Tongi,Gazipur',
      degree: 'Bachelor of Arts (Honours)', specialization: 'English', institution: 'Uttara Town College', cgpa: 2.53,
      lastPosition: 'Administrative Officer', workplace: 'Creative Wash Ltd - 01 (Ha-Meem Group)',
      skills: 'Microsoft Office, Time Management',
      certifications: 'Firefighting, Fire Prevention, Rescue and First Aider Training.; Social Compliance & Environmental Management (SICIP-BGMEA)',
    });
    expect(ex.previousJobs).toBe('Administrative Officer, Creative Wash Ltd - 01 (Ha-Meem Group)\nAdministrative Officer, Denitex Wash Ltd (Armana Group)');
  });

  it('reads letter-spaced headings, "Company | Title" jobs and an institute written above the degree', () => {
    const ex = extractFromText([
      'SHAHED KARIM', 'SR MANAGER | DESIGN & PD', 'Address', 'Present: H-1, R-2/A, Sector-3,', 'Uttara 1230, Dhaka, Bangladesh',
      'Phone', '+8801784000 102', 'shahed@example.com',
      'E X P E R I E N C E S', 'LANTABUR GROUP | SR MANAGER | DESIGN & PD\t/ 2025 to Present',
      'Leading a creative team, I drive trend research and market analysis.',
      'BEXIMCO | MANAGER | DESIGN & PD\t/ 2017 to 2024', 'I analyze market trends and create product concepts and tech packs,and',
      'E D U C A T I O N\t/ 2018 - 2019', 'SHANTO-MARIAM UNIVERSITY OF CREATIVE TECHNOLOGY', 'MASTER OF FASHION DESIGN & TECHNOLOGY',
    ].join('\n'));
    expect(ex).toMatchObject({
      address: 'H-1, R-2/A, Sector-3, Uttara 1230, Dhaka, Bangladesh', phone: '01784000102',
      degree: 'MASTER OF FASHION DESIGN & TECHNOLOGY', specialization: 'FASHION DESIGN & TECHNOLOGY',
      institution: 'SHANTO-MARIAM UNIVERSITY OF CREATIVE TECHNOLOGY',
      lastPosition: 'SR MANAGER | DESIGN & PD', workplace: 'LANTABUR GROUP',
    });
    expect(ex.previousJobs).toBe('SR MANAGER | DESIGN & PD, LANTABUR GROUP\nMANAGER | DESIGN & PD, BEXIMCO');
  });

  it('reads labelled job blocks and a degree written before its education heading', () => {
    const ex = extractFromText([
      'House # Capital Park (2nd Floor)\tMobile no # 01712 000111', 'Flat no. C2, Muktizoddha Road,\tHome cell # 01796 000222', 'Azompur, Uttara, Dhaka\tE-mail # hasan@example.com',
      'MD. HASAN MAHMUD',
      'Total Experience: 20 years running (2006 to till date)',
      'Experience\tPRESENT JOB STATUS :', 'Job Position : AGM (HR, Admin & Compliance)', 'Duration : February 18, 2023 to Continuing.',
      'Company Name : EDISON GROUP (Garments Manufacturer)', 'Professional Experience: II', 'Duration : January 01, 2011 to December 09, 2013.',
      'Job Position : Assistant Manager (HR & Compliance)', 'Company Name : Shore to Shore Bangladesh Ltd.',
      'MBA (Human Resource Management)', 'Education Session : 2009 - 2010\tUniversity of South Asia, Bangladesh', 'Passing year : 2010', 'CGPA – 3.50 (-A)',
      'B.Sc. Honors in Geology & Mining', 'Session 1998-1999\tUniversity of Rajshahi',
      'Date of Birth\tNovember 20, 1980.',
    ].join('\n'), { nameHint: 'MD. HASAN MAHMUD', today: TODAY });
    expect(ex).toMatchObject({
      name: 'MD. HASAN MAHMUD', phone: '01712000111', email: 'hasan@example.com',
      address: 'House # Capital Park (2nd Floor) Flat no. C2, Muktizoddha Road, Azompur, Uttara, Dhaka',
      totalExperienceYears: 20, lastPosition: 'AGM (HR, Admin & Compliance)', workplace: 'EDISON GROUP (Garments Manufacturer)',
      degree: 'MBA (Human Resource Management)', specialization: 'Human Resource Management', institution: 'University of South Asia, Bangladesh',
      cgpa: 3.5, age: 45,
    });
    expect(ex.previousJobs).toBe('AGM (HR, Admin & Compliance), EDISON GROUP (Garments Manufacturer)\nAssistant Manager (HR & Compliance), Shore to Shore Bangladesh Ltd.');
  });

  it('counts a running bachelor when nothing higher is finished', () => {
    const ex = extractFromText([
      'NADIM ISLAM', 'Contact : 01609000111 | Email : nadim@example.com |', 'Adress : Mirpur, Dhaka-1216',
      'EDUCATION', 'Bachelor of Science in Textile Engineering', 'Jhenaidah Textile Engineering College, Jhenaidah\tSession: 2021-2022',
      'Affiliated by Bangladesh University of Textiles\tLevel 4 - Term 2', 'CGPA: 3.47/4.00 (Current)', 'Higher Secondary Certificate', 'Year: 2020', 'Adamjee Cantonment College,Dhaka',
      'INDUSTRIAL EXPERIENCE', 'Fakhruddin Textile Mills ( Urmi Group | Internship Trainee )\tSeptember-November 2026', 'Gained hands-on exposure to knitting.',
    ].join('\n'));
    expect(ex).toMatchObject({
      address: 'Mirpur, Dhaka-1216', degree: 'Bachelor of Science in Textile Engineering', specialization: 'Textile Engineering',
      institution: 'Jhenaidah Textile Engineering College, Jhenaidah', cgpa: 3.47,
      lastPosition: 'Internship Trainee', workplace: 'Fakhruddin Textile Mills (Urmi Group)',
    });
  });
});

describe('PDF layout', () => {
  const item = (str: string, x: number, y: number, h = 10, w = str.length * h * 0.5): PdfItem => ({ str, x, y, w, h });

  it('reads a sidebar column before the main column instead of mixing their lines', () => {
    const left = ['CONTACT', '01711000111', 'a@example.com', 'SKILLS', 'Microsoft Excel and Power BI', 'Outlook', 'Teamwork', 'Planning'].map((s, i) => item(s, 40, 700 - i * 18, 9, s.length * 5.5));
    const right = ['EXPERIENCE', 'Officer, Alpha Ltd', 'Duties described here', 'EDUCATION', 'BBA in Marketing', 'Dhaka University', 'CGPA 3.50 / 4.00'].map((s, i) => item(s, 260, 705 - i * 13, 9, 280));
    const lay = layoutPdf([{ width: 595, height: 842, items: [item('JANE DOE', 260, 790, 30), ...left, ...right] }]);
    const lines = lay.text.split('\n');
    expect(lines.indexOf('Planning')).toBeLessThan(lines.indexOf('EXPERIENCE'));
    expect(lines.slice(lines.indexOf('EDUCATION'), lines.indexOf('EDUCATION') + 3)).toEqual(['EDUCATION', 'BBA in Marketing', 'Dhaka University']);
    expect(lay.nameHint).toBe('JANE DOE');
  });

  it('rebuilds a table whose cells wrap over several lines into one row per entry', () => {
    const items = [
      item('Academic Qualification:', 57, 500, 12),
      item('Exam Title', 117, 463, 11, 51), item('Concentration/', 186, 463, 11, 75), item('Major', 209, 450, 11, 29),
      item('Institute', 287, 463, 11, 41), item('Result', 358, 463, 11, 30), item('Pass.Year', 396, 463, 11, 45), item('Duration', 446, 463, 11, 44),
      // row 1: the institute and the result wrap
      item('Bachelor of Arts', 112, 435, 9, 63), item('(BA)', 135, 424, 9, 16), item('History', 208, 435, 9, 29),
      item('Modhupur Adorsho', 269, 435, 9, 79), item('College', 291, 424, 9, 34),
      item('Second', 358, 435, 9, 29), item('Class', 363, 424, 9, 20), item('Marks:', 360, 413, 9, 26), item('52%', 361, 402, 9, 24),
      item('2016', 408, 435, 9, 19), item('3', 465, 435, 9, 5),
      // row 2
      item('HSC', 130, 387, 9, 20), item('Science', 206, 387, 9, 34), item('Govt. College', 277, 387, 9, 62),
      item('CGPA :', 358, 387, 9, 29), item('4.10 (out of 5)', 352, 376, 9, 40), item('2012', 408, 387, 9, 19), item('2', 465, 387, 9, 5),
      item('Training Summary:', 57, 340, 12),
    ];
    const lay = layoutPdf([{ width: 595, height: 842, items }]);
    expect(lay.text.split('\n')).toEqual([
      'Academic Qualification:',
      'Exam Title: Bachelor of Arts (BA) | Concentration/Major: History | Institute: Modhupur Adorsho College | Result: Second Class Marks: 52% | Pass.Year: 2016 | Duration: 3',
      'Exam Title: HSC | Concentration/Major: Science | Institute: Govt. College | Result: CGPA : 4.10 (out of 5) | Pass.Year: 2012 | Duration: 2',
      'Training Summary:',
    ]);
    const ex = extractFromText(lay.text);
    expect(ex).toMatchObject({ degree: 'Bachelor of Arts (BA)', specialization: 'History', institution: 'Modhupur Adorsho College' });
  });
});
