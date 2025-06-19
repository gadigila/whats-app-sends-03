
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, Users, Clock, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Index = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const features = [
    {
      icon: MessageSquare,
      title: "שליחת הודעות",
      description: "שלח הודעות לקבוצות WhatsApp בקלות"
    },
    {
      icon: Users,
      title: "ניהול קבוצות",
      description: "נהל את כל הקבוצות שלך במקום אחד"
    },
    {
      icon: Clock,
      title: "תזמון הודעות",
      description: "תזמן הודעות לשליחה בזמן מתאים"
    },
    {
      icon: BarChart3,
      title: "דוחות ונתונים",
      description: "עקוב אחר הביצועים שלך"
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
      <div className="container mx-auto px-4 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold text-gray-900 mb-6">
            רימוט WhatsApp
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            הפלטפורמה המובילה לניהול וארגון הודעות WhatsApp. שלח, תזמן ונהל את כל ההודעות שלך במקום אחד.
          </p>
          
          <div className="flex gap-4 justify-center">
            {user ? (
              <Button
                onClick={() => navigate('/whatsapp-connect')}
                size="lg"
                className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 text-lg"
              >
                חבר WhatsApp
              </Button>
            ) : (
              <>
                <Button
                  onClick={() => navigate('/auth')}
                  size="lg"
                  className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 text-lg"
                >
                  התחל עכשיו
                </Button>
                <Button
                  onClick={() => navigate('/auth')}
                  variant="outline"
                  size="lg"
                  className="px-8 py-4 text-lg"
                >
                  התחבר
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Features */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
          {features.map((feature, index) => (
            <Card key={index} className="text-center hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="mx-auto mb-4 p-3 bg-green-100 rounded-full w-fit">
                  <feature.icon className="h-8 w-8 text-green-600" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-sm">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* CTA Section */}
        <div className="text-center bg-white rounded-lg shadow-lg p-12">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            מוכן להתחיל?
          </h2>
          <p className="text-gray-600 mb-8 max-w-lg mx-auto">
            הצטרף אלינו והתחל לנהל את הודעות WhatsApp שלך בצורה מקצועית ויעילה.
          </p>
          
          {!user && (
            <Button
              onClick={() => navigate('/auth')}
              size="lg"
              className="bg-green-600 hover:bg-green-700 text-white px-8 py-4 text-lg"
            >
              הירשם בחינם
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;
