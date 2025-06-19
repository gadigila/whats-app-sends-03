
import Layout from '@/components/Layout';
import SimpleWhatsAppConnector from '@/components/SimpleWhatsAppConnector';
import WhatsAppInstructions from '@/components/WhatsAppInstructions';

const WhatsAppConnect = () => {
  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">חבר את הוואטסאפ שלך</h1>
          <p className="text-gray-600">
            חבר את הוואטסאפ שלך כדי להתחיל לשלוח הודעות לקבוצות
          </p>
        </div>
        
        <SimpleWhatsAppConnector />
        
        <WhatsAppInstructions />
      </div>
    </Layout>
  );
};

export default WhatsAppConnect;
