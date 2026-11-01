/**
 * Writes a sample hiring circular (PDF + text) to the given folder, to check the layout without the database.
 *   npx ts-node scripts/sample-circular.ts <out-dir>
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildCircular, circularPdf, circularText } from '../src/vacancies/circular';

async function main() {
  const out = process.argv[2] ?? '.';
  const jp: any = {
    jobNo: 'JOB-2026-000007', title: 'Executive - Administration Department', status: 'Published',
    description: 'We are looking for a proactive and organized Executive - Administration to support daily factory administration, maintain workforce discipline, and ensure smooth operational activities within our RMG factory.',
    duties: [
      'Maintain daily floor discipline, resolve minor worker conflicts, manage gate security, and ensure a safe work environment.',
      'Oversee the time section: monitor in/out times, track overtime, manage attendance, and process leave & gate passes.',
      'Recruit non-operator workers as needed, issue ID cards, open files, and manage documentation for departed (lefty) workers.',
      'Assist accounts with preparing monthly salary sheets and ensure orderly, disciplined wage distribution.',
      'Educate and motivate workers on company policies and compliance with Bangladesh Labor Law (2006).',
      'Supervise cleaning staff to ensure floor hygiene and maintain cleaning & closing logs.',
      'Maintain operational registers (appointments, handbooks, etc.), approve production store requisitions, and coordinate with other departments.',
      'Any other duties and responsibilities assigned by the supervisor and the management.',
    ].join('\n'),
    skills: 'Strong communication and interpersonal skills\nProficiency in MS Office (Word, Excel, PowerPoint)\nGood organizational and documentation skills\nAbility to work in a factory environment',
    education: 'Graduation in Management (preferred)', requiredDegree: null, minCgpa: null,
    experienceRequirement: '3-6 years in factory administration', location: 'Pagar, Tongi, Gazipur', employmentType: 'Full-time',
    jobShift: 'Day and Night', salary: 'As per company policy', applyEmail: null, emailSubject: 'Executive - Administration Department (RMG Factory)',
    deadline: '2026-11-30',
  };
  const c = buildCircular(jp, { headcount: 2, department: { name: 'Administration' }, company: { name: 'Ananta Apparels Ltd.' } } as any);
  fs.writeFileSync(path.join(out, 'sample-circular.pdf'), await circularPdf(c));
  fs.writeFileSync(path.join(out, 'sample-circular.txt'), circularText(c));
  console.log('written to', path.resolve(out));
}

main();
