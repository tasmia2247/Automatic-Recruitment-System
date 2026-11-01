import { CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Stable internal primary key + timestamps. Display numbers (REQ-…, CAND-…) are separate columns. */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** Numeric columns come back from pg as strings; map them to numbers. */
export const numeric = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? null : Number(v)),
};
