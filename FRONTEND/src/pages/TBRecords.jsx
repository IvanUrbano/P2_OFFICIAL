import { useState } from "react";

/* ─── Status → accent color, drawn from the same palette used on the dashboard ─── */
const statusColors = {
  Active: "#2E6FAF",
  Cured: "#10B981",
  Treatment: "#F59E0B",
  Completed: "#0066FF",
  "Not Evaluated": "#94A3B8",
  Defaulted: "#7c3aed",
  Failed: "#ff0055",
  Died: "#EF4444",
};

function StatusBadge({ status }) {
  const color = statusColors[status] || "#94A3B8";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap"
      style={{ background: `${color}1A`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} />
      {status}
    </span>
  );
}

export default function TBRecords() {
  const [records, setRecords] = useState([
    { id: "TB-2025-0002", barangay: "Bagong Katipunan", age: 31, sex: "Female", diagnosisDate: "2023-02-15", facility: "Bagong Katipunan Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2023-02-10", notificationDate: "2023-02-16", city: "Pasig City", treatmentFacility: "Bagong Katipunan Health Center", sourcePatient: "Referral", anatomicalSite: "Extra-pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-02-18", outcomeDate: "2023-08-20", createdAt: "2023-02-15 10:00 AM" },
    { id: "TB-2025-0003", barangay: "Bambang", age: 42, sex: "Male", diagnosisDate: "2023-03-05", facility: "Bambang Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2023-03-01", notificationDate: "2023-03-06", city: "Pasig City", treatmentFacility: "Bambang Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2023-03-08", outcomeDate: "-", createdAt: "2023-03-05 11:15 AM" },
    { id: "TB-2025-0004", barangay: "Buting", age: 38, sex: "Female", diagnosisDate: "2023-04-20", facility: "Buting Health Center", status: "Not Evaluated", validationStatus: "Pending", screeningDate: "2023-04-15", notificationDate: "2023-04-21", city: "Pasig City", treatmentFacility: "Buting Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-04-22", outcomeDate: "-", createdAt: "2023-04-20 02:30 PM" },
    { id: "TB-2025-0005", barangay: "Caniogan", age: 29, sex: "Male", diagnosisDate: "2023-05-08", facility: "Caniogan Health Center", status: "Defaulted", validationStatus: "Validated", screeningDate: "2023-05-02", notificationDate: "2023-05-09", city: "Pasig City", treatmentFacility: "Caniogan Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "Relapse", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-05-10", outcomeDate: "-", createdAt: "2023-05-08 09:45 AM" },
    { id: "TB-2025-0006", barangay: "Kapasigan", age: 51, sex: "Female", diagnosisDate: "2024-06-22", facility: "Kapasigan Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2024-06-18", notificationDate: "2024-06-23", city: "Pasig City", treatmentFacility: "Kapasigan Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2024-06-25", outcomeDate: "2024-12-25", createdAt: "2024-06-22 04:10 PM" },
    { id: "TB-2025-0007", barangay: "Kapitolyo", age: 34, sex: "Male", diagnosisDate: "2024-07-28", facility: "Kapitolyo Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2024-07-20", notificationDate: "2024-07-29", city: "Pasig City", treatmentFacility: "Kapitolyo Health Center", sourcePatient: "Walk-in", anatomicalSite: "Extra-pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-08-01", outcomeDate: "-", createdAt: "2024-07-28 01:20 PM" },
    { id: "TB-2025-0008", barangay: "Malinao", age: 44, sex: "Female", diagnosisDate: "2024-08-15", facility: "Malinao Health Center", status: "Not Evaluated", validationStatus: "Pending", screeningDate: "2024-08-10", notificationDate: "2024-08-16", city: "Pasig City", treatmentFacility: "Malinao Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-08-18", outcomeDate: "-", createdAt: "2024-08-15 10:45 AM" },
    { id: "TB-2025-0009", barangay: "Oranbo", age: 27, sex: "Male", diagnosisDate: "2024-09-01", facility: "Oranbo Health Center", status: "Defaulted", validationStatus: "Validated", screeningDate: "2024-08-25", notificationDate: "2024-09-02", city: "Pasig City", treatmentFacility: "Oranbo Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2024-09-04", outcomeDate: "-", createdAt: "2024-09-01 11:30 AM" },
    { id: "TB-2025-0010", barangay: "Palatiw", age: 55, sex: "Female", diagnosisDate: "2024-10-05", facility: "Palatiw Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2024-10-01", notificationDate: "2024-10-06", city: "Pasig City", treatmentFacility: "Palatiw Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-10-08", outcomeDate: "2025-04-10", createdAt: "2024-10-05 03:15 PM" },
    { id: "TB-2025-0011", barangay: "Pineda", age: 36, sex: "Male", diagnosisDate: "2024-11-10", facility: "Pineda Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2024-11-05", notificationDate: "2024-11-11", city: "Pasig City", treatmentFacility: "Pineda Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-11-13", outcomeDate: "-", createdAt: "2024-11-10 09:10 AM" },
    { id: "TB-2025-0012", barangay: "Sagad", age: 48, sex: "Female", diagnosisDate: "2024-12-25", facility: "Sagad Health Center", status: "Failed", validationStatus: "Pending", screeningDate: "2024-12-20", notificationDate: "2024-12-26", city: "Pasig City", treatmentFacility: "Sagad Health Center", sourcePatient: "Walk-in", anatomicalSite: "Extra-pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-12-28", outcomeDate: "-", createdAt: "2024-12-25 04:30 PM" },
    { id: "TB-2025-0013", barangay: "San Antonio", age: 32, sex: "Male", diagnosisDate: "2025-01-10", facility: "San Antonio Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2025-01-05", notificationDate: "2025-01-11", city: "Pasig City", treatmentFacility: "San Antonio Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2025-01-12", outcomeDate: "-", createdAt: "2025-01-10 10:20 AM" },
    { id: "TB-2025-0014", barangay: "San Joaquin", age: 26, sex: "Female", diagnosisDate: "2025-02-20", facility: "San Joaquin Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2025-02-15", notificationDate: "2025-02-21", city: "Pasig City", treatmentFacility: "San Joaquin Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2025-02-23", outcomeDate: "2025-06-06", createdAt: "2025-02-20 01:15 PM" },
    { id: "TB-2025-0015", barangay: "San Jose", age: 39, sex: "Male", diagnosisDate: "2025-03-28", facility: "San Jose Health Center", status: "Not Evaluated", validationStatus: "Pending", screeningDate: "2025-03-22", notificationDate: "2025-03-29", city: "Pasig City", treatmentFacility: "San Jose Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2025-04-01", outcomeDate: "-", createdAt: "2025-03-28 02:40 PM" },
    { id: "TB-2025-0016", barangay: "Dela Paz", age: 45, sex: "Female", diagnosisDate: "2023-06-30", facility: "Dela Paz Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2023-06-25", notificationDate: "2023-07-01", city: "Pasig City", treatmentFacility: "Dela Paz Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-07-03", outcomeDate: "-", createdAt: "2023-06-30 03:50 PM" },
    { id: "TB-2025-0017", barangay: "Kalawaan", age: 41, sex: "Male", diagnosisDate: "2023-07-05", facility: "Kalawaan Health Center", status: "Defaulted", validationStatus: "Pending", screeningDate: "2023-06-30", notificationDate: "2023-07-06", city: "Pasig City", treatmentFacility: "Kalawaan Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-07-08", outcomeDate: "-", createdAt: "2023-07-05 11:20 AM" },
    { id: "TB-2025-0018", barangay: "Manggahan", age: 58, sex: "Female", diagnosisDate: "2023-08-12", facility: "Manggahan Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2023-08-05", notificationDate: "2023-08-13", city: "Pasig City", treatmentFacility: "Manggahan Health Center", sourcePatient: "Referral", anatomicalSite: "Extra-pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-08-15", outcomeDate: "2024-02-15", createdAt: "2023-08-12 09:30 AM" },
    { id: "TB-2025-0019", barangay: "Maybunga", age: 23, sex: "Male", diagnosisDate: "2023-09-08", facility: "Maybunga Health Center", status: "Defaulted", validationStatus: "Validated", screeningDate: "2023-09-02", notificationDate: "2023-09-09", city: "Pasig City", treatmentFacility: "Maybunga Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2023-09-11", outcomeDate: "-", createdAt: "2023-09-08 10:15 AM" },
    { id: "TB-2025-0020", barangay: "Pinagbuhatan", age: 50, sex: "Female", diagnosisDate: "2023-10-18", facility: "Pinagbuhatan Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2023-10-12", notificationDate: "2023-10-19", city: "Pasig City", treatmentFacility: "Pinagbuhatan Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "Relapse", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-10-21", outcomeDate: "-", createdAt: "2023-10-18 04:45 PM" },
    { id: "TB-2025-0021", barangay: "Rosario", age: 35, sex: "Male", diagnosisDate: "2023-11-14", facility: "Rosario Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2023-11-08", notificationDate: "2023-11-15", city: "Pasig City", treatmentFacility: "Rosario Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-11-18", outcomeDate: "2024-05-18", createdAt: "2023-11-14 02:10 PM" },
    { id: "TB-2025-0022", barangay: "San Miguel", age: 47, sex: "Female", diagnosisDate: "2023-12-22", facility: "San Miguel Health Center", status: "Not Evaluated", validationStatus: "Pending", screeningDate: "2023-12-15", notificationDate: "2023-12-23", city: "Pasig City", treatmentFacility: "San Miguel Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-12-26", outcomeDate: "-", createdAt: "2023-12-22 11:40 AM" },
    { id: "TB-2025-0023", barangay: "San Nicolas", age: 28, sex: "Male", diagnosisDate: "2024-01-02", facility: "San Nicolas Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2023-12-28", notificationDate: "2024-01-03", city: "Pasig City", treatmentFacility: "San Nicolas Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2024-01-05", outcomeDate: "-", createdAt: "2024-01-02 09:20 AM" },
    { id: "TB-2025-0024", barangay: "Santa Cruz", age: 56, sex: "Female", diagnosisDate: "2024-02-18", facility: "Santa Cruz Health Center", status: "Defaulted", validationStatus: "Pending", screeningDate: "2024-02-12", notificationDate: "2024-02-19", city: "Pasig City", treatmentFacility: "Santa Cruz Health Center", sourcePatient: "Walk-in", anatomicalSite: "Extra-pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-02-21", outcomeDate: "-", createdAt: "2024-02-18 03:15 PM" },
    { id: "TB-2025-0025", barangay: "Santa Lucia", age: 30, sex: "Male", diagnosisDate: "2024-03-15", facility: "Santa Lucia Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2024-03-10", notificationDate: "2024-03-16", city: "Pasig City", treatmentFacility: "Santa Lucia Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-03-18", outcomeDate: "2024-09-18", createdAt: "2024-03-15 10:30 AM" },
    { id: "TB-2025-0026", barangay: "Santa Rosa", age: 52, sex: "Female", diagnosisDate: "2024-04-28", facility: "Santa Rosa Health Center", status: "Died", validationStatus: "Pending", screeningDate: "2024-04-22", notificationDate: "2024-04-29", city: "Pasig City", treatmentFacility: "Santa Rosa Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-05-01", outcomeDate: "-", createdAt: "2024-04-28 01:45 PM" },
    { id: "TB-2025-0027", barangay: "Santo Tomas", age: 24, sex: "Male", diagnosisDate: "2024-05-05", facility: "Santo Tomas Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2024-04-28", notificationDate: "2024-05-06", city: "Pasig City", treatmentFacility: "Santo Tomas Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-05-08", outcomeDate: "-", createdAt: "2024-05-05 09:15 AM" },
    { id: "TB-2025-0028", barangay: "Santolan", age: 40, sex: "Female", diagnosisDate: "2025-02-02", facility: "Santolan Health Center", status: "Not Evaluated", validationStatus: "Validated", screeningDate: "2025-01-25", notificationDate: "2025-02-03", city: "Pasig City", treatmentFacility: "Santolan Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2025-02-05", outcomeDate: "-", createdAt: "2025-02-02 11:10 AM" },
    { id: "TB-2025-0029", barangay: "Sumilang", age: 33, sex: "Male", diagnosisDate: "2025-01-08", facility: "Sumilang Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2025-01-02", notificationDate: "2025-01-09", city: "Pasig City", treatmentFacility: "Sumilang Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2025-01-11", outcomeDate: "2025-06-05", createdAt: "2025-01-08 10:05 AM" },
    { id: "TB-2025-0030", barangay: "Ugong", age: 49, sex: "Female", diagnosisDate: "2025-02-25", facility: "Ugong Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2025-02-20", notificationDate: "2025-02-26", city: "Pasig City", treatmentFacility: "Ugong Health Center", sourcePatient: "Walk-in", anatomicalSite: "Extra-pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2025-02-28", outcomeDate: "-", createdAt: "2025-02-25 02:50 PM" },
    { id: "TB-2025-0031", barangay: "Bagong Ilog", age: 37, sex: "Male", diagnosisDate: "2023-01-14", facility: "Bagong Ilog Health Center", status: "Defaulted", validationStatus: "Validated", screeningDate: "2023-01-08", notificationDate: "2023-01-15", city: "Pasig City", treatmentFacility: "Bagong Ilog Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-01-16", outcomeDate: "-", createdAt: "2023-01-14 09:40 AM" },
    { id: "TB-2025-0032", barangay: "Bagong Katipunan", age: 43, sex: "Female", diagnosisDate: "2024-03-11", facility: "Bagong Katipunan Health Center", status: "Defaulted", validationStatus: "Pending", screeningDate: "2024-03-05", notificationDate: "2024-03-12", city: "Pasig City", treatmentFacility: "Bagong Katipunan Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-03-14", outcomeDate: "-", createdAt: "2024-03-11 11:25 AM" },
    { id: "TB-2025-0033", barangay: "Bambang", age: 54, sex: "Male", diagnosisDate: "2025-02-09", facility: "Bambang Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2025-02-02", notificationDate: "2025-02-10", city: "Pasig City", treatmentFacility: "Bambang Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2025-02-12", outcomeDate: "2025-06-06", createdAt: "2025-02-09 10:15 AM" },
    { id: "TB-2025-0034", barangay: "Buting", age: 22, sex: "Female", diagnosisDate: "2023-01-19", facility: "Buting Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2023-01-12", notificationDate: "2023-01-20", city: "Pasig City", treatmentFacility: "Buting Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2023-01-22", outcomeDate: "-", createdAt: "2023-01-19 03:30 PM" },
    { id: "TB-2025-0035", barangay: "Caniogan", age: 46, sex: "Male", diagnosisDate: "2024-02-12", facility: "Caniogan Health Center", status: "Failed", validationStatus: "Pending", screeningDate: "2024-02-05", notificationDate: "2024-02-13", city: "Pasig City", treatmentFacility: "Caniogan Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-02-15", outcomeDate: "-", createdAt: "2024-02-12 11:55 AM" },
    { id: "TB-2025-0036", barangay: "Kapasigan", age: 60, sex: "Female", diagnosisDate: "2024-12-20", facility: "Kapasigan Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2024-12-15", notificationDate: "2024-12-21", city: "Pasig City", treatmentFacility: "Kapasigan Health Center", sourcePatient: "Walk-in", anatomicalSite: "Extra-pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-12-23", outcomeDate: "2025-06-04", createdAt: "2024-12-20 02:40 PM" },
    { id: "TB-2025-0037", barangay: "Kapitolyo", age: 26, sex: "Male", diagnosisDate: "2025-02-26", facility: "Kapitolyo Health Center", status: "Not Evaluated", validationStatus: "Validated", screeningDate: "2025-02-20", notificationDate: "2025-02-27", city: "Pasig City", treatmentFacility: "Kapitolyo Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2025-03-01", outcomeDate: "-", createdAt: "2025-02-26 04:15 PM" },
    { id: "TB-2025-0038", barangay: "Malinao", age: 53, sex: "Female", diagnosisDate: "2023-01-24", facility: "Malinao Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2023-01-18", notificationDate: "2023-01-25", city: "Pasig City", treatmentFacility: "Malinao Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-01-27", outcomeDate: "-", createdAt: "2023-01-24 10:25 AM" },
    { id: "TB-2025-0039", barangay: "Oranbo", age: 31, sex: "Male", diagnosisDate: "2025-03-03", facility: "Oranbo Health Center", status: "Defaulted", validationStatus: "Pending", screeningDate: "2025-02-25", notificationDate: "2025-03-04", city: "Pasig City", treatmentFacility: "Oranbo Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2025-03-06", outcomeDate: "-", createdAt: "2025-03-03 01:50 PM" },
    { id: "TB-2025-0040", barangay: "Palatiw", age: 57, sex: "Female", diagnosisDate: "2024-01-11", facility: "Palatiw Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2024-01-05", notificationDate: "2024-01-12", city: "Pasig City", treatmentFacility: "Palatiw Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-01-14", outcomeDate: "2024-07-14", createdAt: "2024-01-11 09:35 AM" },
    { id: "TB-2025-0041", barangay: "Pineda", age: 29, sex: "Male", diagnosisDate: "2024-02-21", facility: "Pineda Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2024-02-15", notificationDate: "2024-02-22", city: "Pasig City", treatmentFacility: "Pineda Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-02-24", outcomeDate: "-", createdAt: "2024-02-21 11:45 AM" },
    { id: "TB-2025-0042", barangay: "Sagad", age: 38, sex: "Female", diagnosisDate: "2023-01-31", facility: "Sagad Health Center", status: "Defaulted", validationStatus: "Validated", screeningDate: "2023-01-25", notificationDate: "2023-02-01", city: "Pasig City", treatmentFacility: "Sagad Health Center", sourcePatient: "Walk-in", anatomicalSite: "Extra-pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-02-03", outcomeDate: "-", createdAt: "2023-01-31 03:50 PM" },
    { id: "TB-2025-0043", barangay: "San Antonio", age: 44, sex: "Male", diagnosisDate: "2025-03-07", facility: "San Antonio Health Center", status: "Not Evaluated", validationStatus: "Pending", screeningDate: "2025-03-01", notificationDate: "2025-03-08", city: "Pasig City", treatmentFacility: "San Antonio Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2025-03-10", outcomeDate: "-", createdAt: "2025-03-07 10:20 AM" },
    { id: "TB-2025-0044", barangay: "San Joaquin", age: 51, sex: "Female", diagnosisDate: "2024-02-03", facility: "San Joaquin Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2024-01-28", notificationDate: "2024-02-04", city: "Pasig City", treatmentFacility: "San Joaquin Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-02-06", outcomeDate: "2024-08-06", createdAt: "2024-02-03 01:10 PM" },
    { id: "TB-2025-0045", barangay: "San Jose", age: 27, sex: "Male", diagnosisDate: "2023-01-27", facility: "San Jose Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2023-01-20", notificationDate: "2023-01-28", city: "Pasig City", treatmentFacility: "San Jose Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-01-30", outcomeDate: "-", createdAt: "2023-01-27 02:25 PM" },
    { id: "TB-2025-0046", barangay: "Dela Paz", age: 35, sex: "Female", diagnosisDate: "2024-02-16", facility: "Dela Paz Health Center", status: "Defaulted", validationStatus: "Pending", screeningDate: "2024-02-10", notificationDate: "2024-02-17", city: "Pasig City", treatmentFacility: "Dela Paz Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-02-19", outcomeDate: "-", createdAt: "2024-02-16 04:35 PM" },
    { id: "TB-2025-0047", barangay: "Kalawaan", age: 39, sex: "Male", diagnosisDate: "2024-12-10", facility: "Kalawaan Health Center", status: "Cured", validationStatus: "Validated", screeningDate: "2024-12-05", notificationDate: "2024-12-11", city: "Pasig City", treatmentFacility: "Kalawaan Health Center", sourcePatient: "Referral", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-12-13", outcomeDate: "2025-06-05", createdAt: "2024-12-10 11:45 AM" },
    { id: "TB-2025-0048", barangay: "Manggahan", age: 62, sex: "Female", diagnosisDate: "2023-01-23", facility: "Manggahan Health Center", status: "Died", validationStatus: "Pending", screeningDate: "2023-01-18", notificationDate: "2023-01-24", city: "Pasig City", treatmentFacility: "Manggahan Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2023-01-26", outcomeDate: "-", createdAt: "2023-01-23 09:50 AM" },
    { id: "TB-2025-0049", barangay: "Maybunga", age: 20, sex: "Male", diagnosisDate: "2025-03-04", facility: "Maybunga Health Center", status: "Completed", validationStatus: "Validated", screeningDate: "2025-02-26", notificationDate: "2025-03-05", city: "Pasig City", treatmentFacility: "Maybunga Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Clinically Diagnosed", treatmentStartDate: "2025-03-07", outcomeDate: "-", createdAt: "2025-03-04 10:15 AM" },
    { id: "TB-2025-0050", barangay: "Pinagbuhatan", age: 48, sex: "Female", diagnosisDate: "2024-02-07", facility: "Pinagbuhatan Health Center", status: "Failed", validationStatus: "Validated", screeningDate: "2024-02-01", notificationDate: "2024-02-08", city: "Pasig City", treatmentFacility: "Pinagbuhatan Health Center", sourcePatient: "Walk-in", anatomicalSite: "Pulmonary", registrationGroup: "New", bacteriologicalStatus: "Confirmed", treatmentStartDate: "2024-02-10", outcomeDate: "-", createdAt: "2024-02-07 02:20 PM" },
  ]);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedBarangay, setSelectedBarangay] = useState("");
  const [selectedOutcomeStatus, setSelectedOutcomeStatus] = useState("");
  const [selectedRecord, setSelectedRecord] = useState(null);
  const recordsPerPage = 10;

  const barangays = ["Bagong Ilog", "Bagong Katipunan", "Bambang", "Buting", "Caniogan", "Kapasigan", "Kapitolyo", "Malinao", "Oranbo", "Palatiw", "Pineda", "Sagad", "San Antonio", "San Joaquin", "San Jose", "Dela Paz", "Kalawaan", "Manggahan", "Maybunga", "Pinagbuhatan", "Rosario", "San Miguel", "San Nicolas", "Santa Cruz", "Santa Lucia", "Santa Rosa", "Santo Tomas", "Santolan", "Sumilang", "Ugong"];

  const outcomeStatuses = [...new Set(records.map((record) => record.status).filter(Boolean))].sort();

  const getMonthNumber = (month) => {
    const months = { January: "01", February: "02", March: "03", April: "04", May: "05", June: "06", July: "07", August: "08", September: "09", October: "10", November: "11", December: "12" };
    return months[month] || "";
  };

  const filteredRecords = records.filter((record) => {
    const matchesSearch = searchTerm === "" ||
      record.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.barangay.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.facility.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesYear = selectedYear === "" || record.diagnosisDate.startsWith(selectedYear);
    const matchesMonth = selectedMonth === "" || record.diagnosisDate.includes("-" + getMonthNumber(selectedMonth).padStart(2, "0") + "-");
    const matchesBarangay = selectedBarangay === "" || record.barangay === selectedBarangay;
    const matchesOutcomeStatus = selectedOutcomeStatus === "" || record.status === selectedOutcomeStatus;

    return matchesSearch && matchesYear && matchesMonth && matchesBarangay && matchesOutcomeStatus;
  });

  const handleClearFilters = () => {
    setSearchTerm("");
    setSelectedYear("");
    setSelectedMonth("");
    setSelectedBarangay("");
    setSelectedOutcomeStatus("");
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(filteredRecords.length / recordsPerPage);
  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = startIndex + recordsPerPage;
  const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

  const handlePrevious = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleNext = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  /* Reusable field row for the record detail modal */
  const Field = ({ label, value, badge }) => (
    <div className="flex items-center justify-between gap-4">
      <span style={{ color: "#64748b" }}>{label}</span>
      {badge ? (
        <StatusBadge status={value} />
      ) : (
        <span className="font-semibold" style={{ color: "#0f172a" }}>{value || "N/A"}</span>
      )}
    </div>
  );

  return (
    <div className="relative space-y-5">

      {/* ── Toolbar: actions + filters ── */}
      <div className="glass-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
            <i className="ri-folder-chart-2-line text-lg" style={{ color: "#2E6FAF" }} />
            <span>TB Case Records</span>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold transition hover:opacity-80"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}
            >
              <i className="ri-upload-2-line text-sm" />
              Import
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-xs font-bold text-white transition hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #0066FF 0%, #00D8F6 100%)" }}
            >
              <i className="ri-download-2-line text-sm" />
              Export
            </button>
          </div>
        </div>

        <div className="mt-5 grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <label className="relative block w-full">
            <span className="sr-only">Search records</span>
            <i
              className="ri-search-line pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm"
              style={{ color: "#94a3b8" }}
            />
            <input
              type="search"
              placeholder="Search records"
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              className="w-full rounded-lg py-2 pl-9 pr-3 text-xs font-medium outline-none transition focus:ring-2"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
            />
          </label>

          <select
            value={selectedYear}
            onChange={(e) => { setSelectedYear(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
          >
            <option value="">All Years</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
          </select>

          <select
            value={selectedMonth}
            onChange={(e) => { setSelectedMonth(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
          >
            <option value="">All Months</option>
            <option value="January">January</option>
            <option value="February">February</option>
            <option value="March">March</option>
            <option value="April">April</option>
            <option value="May">May</option>
            <option value="June">June</option>
            <option value="July">July</option>
            <option value="August">August</option>
            <option value="September">September</option>
            <option value="October">October</option>
            <option value="November">November</option>
            <option value="December">December</option>
          </select>

          <select
            value={selectedBarangay}
            onChange={(e) => { setSelectedBarangay(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
          >
            <option value="">All Barangays</option>
            {barangays.map((barangay) => (
              <option key={barangay} value={barangay}>{barangay}</option>
            ))}
          </select>

          <select
            value={selectedOutcomeStatus}
            onChange={(e) => { setSelectedOutcomeStatus(e.target.value); setCurrentPage(1); }}
            className="w-full rounded-lg px-3 py-2 pr-8 text-xs font-medium outline-none transition"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#0f172a" }}
          >
            <option value="">All Outcomes</option>
            {outcomeStatuses.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>

          <button
            onClick={handleClearFilters}
            className="w-full rounded-lg px-3 py-2 text-xs font-bold transition hover:opacity-80"
            style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}
          >
            Clear Filters
          </button>
        </div>
      </div>

      {/* ── Records table ── */}
      <div className="glass-card overflow-hidden">
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
            <i className="ri-table-line text-lg" style={{ color: "#2E6FAF" }} />
            <span>Case Records</span>
          </div>
          <span className="text-xs font-bold" style={{ color: "#64748b" }}>
            {filteredRecords.length} total
          </span>
        </div>

        <div className="mt-4 min-h-[480px] overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr>
                {["Case ID", "Barangay", "Age", "Sex", "Diagnosis", "Facility", "Treatment Outcome", "Action"].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "#64748b", borderBottom: "1px solid rgba(148,163,184,.15)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedRecords.map((record) => (
                <tr
                  key={record.id}
                  style={{ borderTop: "1px solid rgba(148,163,184,.1)" }}
                >
                  <td className="px-5 py-3 font-bold" style={{ color: "#0f172a" }}>{record.id}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.barangay}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.age}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.sex}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.diagnosisDate}</td>
                  <td className="px-5 py-3" style={{ color: "#475569" }}>{record.facility}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={record.status} />
                  </td>
                  <td className="px-5 py-3">
                    <button
                      aria-label="View record"
                      onClick={() => setSelectedRecord(record)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition hover:opacity-80"
                      style={{ background: "rgba(46,111,175,0.1)", border: "1px solid rgba(46,111,175,0.25)", color: "#2E6FAF" }}
                    >
                      <i className="ri-eye-line text-sm" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div
          className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
          style={{ borderTop: "1px solid rgba(148,163,184,.15)" }}
        >
          <p className="text-xs font-semibold" style={{ color: "#64748b" }}>
            Showing {filteredRecords.length === 0 ? 0 : startIndex + 1}–{Math.min(endIndex, filteredRecords.length)} of {filteredRecords.length} records
          </p>
          <div className="flex gap-2">
            <button
              aria-label="Previous page"
              onClick={handlePrevious}
              disabled={currentPage === 1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}
            >
              <i className="ri-arrow-left-s-line text-base" />
            </button>
            <button
              aria-label="Next page"
              onClick={handleNext}
              disabled={currentPage === totalPages || totalPages === 0}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#475569" }}
            >
              <i className="ri-arrow-right-s-line text-base" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Record detail modal ── */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-sm">
          <div
            className="glass-card w-full max-w-3xl max-h-[90vh] overflow-hidden"
            style={{ background: "rgba(255,255,255,0.97)" }}
          >
            <div
              className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderBottom: "1px solid rgba(148,163,184,.15)" }}
            >
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: "#64748b" }}>
                  TB Record
                </p>
                <h2 className="mt-2 text-xl font-bold tracking-tight" style={{ color: "#0f172a" }}>
                  Record details
                </h2>
                <p className="mt-1.5 max-w-xl text-sm leading-6" style={{ color: "#64748b" }}>
                  Detailed TB case information, including patient, screening, and treatment data.
                </p>
              </div>
              <button
                onClick={() => setSelectedRecord(null)}
                aria-label="Close modal"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:opacity-80"
                style={{ background: "#f1f5f9", color: "#475569" }}
              >
                <i className="ri-close-line text-base" />
              </button>
            </div>

            <div className="space-y-4 overflow-y-auto px-6 py-6" style={{ maxHeight: "70vh" }}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl p-5" style={{ background: "#f8fafc" }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
                    <i className="ri-file-list-3-line" style={{ color: "#2E6FAF" }} />
                    Case summary
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Case ID" value={selectedRecord.id} />
                    <Field label="Validation Status" value={selectedRecord.validationStatus} />
                    <Field label="Created" value={selectedRecord.createdAt} />
                    <Field label="Treatment Outcome" value={selectedRecord.status} badge />
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{ background: "#f8fafc" }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
                    <i className="ri-user-line" style={{ color: "#2E6FAF" }} />
                    Patient information
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Age" value={selectedRecord.age} />
                    <Field label="Sex" value={selectedRecord.sex} />
                    <Field label="Barangay" value={selectedRecord.barangay} />
                    <Field label="City" value={selectedRecord.city || "Pasig City"} />
                    <Field label="Source" value={selectedRecord.sourcePatient} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl p-5" style={{ background: "#f8fafc" }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
                    <i className="ri-stethoscope-line" style={{ color: "#2E6FAF" }} />
                    Screening & diagnosis
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Screening Date" value={selectedRecord.screeningDate} />
                    <Field label="Diagnosis Date" value={selectedRecord.diagnosisDate} />
                    <Field label="Notification Date" value={selectedRecord.notificationDate} />
                    <Field label="Facility" value={selectedRecord.facility} />
                  </div>
                </div>

                <div className="rounded-2xl p-5" style={{ background: "#f8fafc" }}>
                  <p className="flex items-center gap-2 text-sm font-bold" style={{ color: "#0f172a" }}>
                    <i className="ri-capsule-line" style={{ color: "#2E6FAF" }} />
                    Clinical & treatment
                  </p>
                  <div className="mt-4 space-y-3 text-sm">
                    <Field label="Anatomical Site" value={selectedRecord.anatomicalSite} />
                    <Field label="Registration Group" value={selectedRecord.registrationGroup} />
                    <Field label="Bacteriological Status" value={selectedRecord.bacteriologicalStatus} />
                    <Field label="Treatment Facility" value={selectedRecord.treatmentFacility || selectedRecord.facility} />
                    <Field label="Started Treatment" value={selectedRecord.treatmentStartDate} />
                    <Field label="Outcome Date" value={selectedRecord.outcomeDate} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}