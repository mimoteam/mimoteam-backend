import { Schema, model, Document } from 'mongoose';

export interface ICost extends Document {
  serviceType: string;
  team?: string;
  location?: string;
  park?: string;
  guests?: number | null; // número de convidados (opcional)
  hopper?: '' | 'TRUE' | 'FALSE'; // compatível com front
  hours?: number | null; // horas (opcional)
  amount: number; // valor $
  createdAt: Date;
  updatedAt: Date;
}

const CostSchema = new Schema<ICost>(
  {
    serviceType: { type: String, required: true, trim: true, uppercase: true },
    team:       { type: String, trim: true, uppercase: true, default: '' },
    location:   { type: String, trim: true, uppercase: true, default: '' },
    park:       { type: String, trim: true, uppercase: true, default: '' },
    guests:     { type: Number, default: null },
    hopper:     { type: String, enum: ['', 'TRUE', 'FALSE'], default: '' },
    hours:      { type: Number, default: null },
    amount:     { type: Number, required: true },
  },
  { timestamps: true }
);

export default model<ICost>('Cost', CostSchema);
