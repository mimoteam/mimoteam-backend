// backend/src/services/service.model.ts
import { Schema, model, type Document } from "mongoose";

interface IServiceType {
  id: string;
  name?: string;
}
interface IPartnerRef {
  id: string;
  name?: string;
  email?: string;
}

export interface IService extends Document {
  serviceDate: Date;
  firstName?: string;
  lastName?: string;
  clientName?: string;
  park?: string;
  location?: string;
  guests?: number | null;
  hopper?: boolean;
  team?: string;
  finalValue: number;

  serviceType?: IServiceType | string | null;
  serviceTypeId?: string;

  partnerId?: string;
  partner?: IPartnerRef | null;

  // ➕ campos usados no front/controladores
  serviceTime?: number | null;
  observations?: string;
  overrideValue?: number | null;
  calculatedPrice?: any | null;
  status?: string;

  createdAt: Date;
  updatedAt: Date;
}

const ServiceTypeSchema = new Schema<IServiceType>(
  { id: { type: String, required: true }, name: { type: String, default: "" } },
  { _id: false }
);

const PartnerRefSchema = new Schema<IPartnerRef>(
  { id: { type: String, required: true }, name: String, email: String },
  { _id: false }
);

const ServiceSchema = new Schema<IService>(
  {
    serviceDate: { type: Date, required: true, index: true },
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    clientName: { type: String, default: "" },
    park: { type: String, default: "" },
    location: { type: String, default: "" },
    guests: { type: Number, default: null },
    hopper: { type: Boolean, default: false },
    team: { type: String, default: "" },
    finalValue: { type: Number, required: true },

    // flexível: subdoc OU string id
    serviceType: { type: ServiceTypeSchema, default: null },
    serviceTypeId: { type: String, default: "" },

    // flexível: subdoc OU id plano
    partnerId: { type: String, index: true, default: "" },
    partner: { type: PartnerRefSchema, default: null },

    // ➕ novos campos
    serviceTime: { type: Number, default: null },
    observations: { type: String, default: "" },
    overrideValue: { type: Number, default: null },
    calculatedPrice: { type: Schema.Types.Mixed, default: null },
    status: { type: String, default: "RECORDED" },
  },
  { timestamps: true }
);

// índices úteis para buscas do front
ServiceSchema.index({ partnerId: 1, serviceDate: -1 });
ServiceSchema.index({ "partner.id": 1, serviceDate: -1 });
ServiceSchema.index({ serviceTypeId: 1, serviceDate: -1 });

export const Service = model<IService>("Service", ServiceSchema);
