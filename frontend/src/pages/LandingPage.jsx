import React from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import FeatureCard from '../components/FeatureCard';
import TestimonialCard from '../components/TestimonialCard';
import GradientButton from '../components/GradientButton';
import LiveInterviewPreview from '../components/LiveInterviewPreview';

const LandingPage = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: 'robot',
      title: 'AI-Powered Questions',
      description: 'Get intelligent, role-specific questions tailored to your CV and job description.',
      gradient: 'primary'
    },
    {
      icon: 'chat-dots',
      title: 'Real-time Feedback',
      description: 'Receive instant, constructive feedback on your answers to improve faster.',
      gradient: 'purple'
    },
    {
      icon: 'graph-up',
      title: 'Performance Analytics',
      description: 'Track your progress with detailed analytics and performance insights.',
      gradient: 'cyan'
    },
    {
      icon: 'cloud-upload',
      title: 'Easy CV Upload',
      description: 'Simply upload your CV and job description to get started in seconds.',
      gradient: 'green'
    }
  ];

  const steps = [
    {
      number: 1,
      title: 'Upload Your CV',
      description: 'Upload your resume and the job description you\'re applying for.',
      gradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
    },
    {
      number: 2,
      title: 'Choose Interview Type',
      description: 'Select from HR, Technical, or Behavioral interview simulations.',
      gradient: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)'
    },
    {
      number: 3,
      title: 'Practice Interview',
      description: 'Answer AI-generated questions in a realistic interview environment.',
      gradient: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)'
    },
    {
      number: 4,
      title: 'Get Feedback',
      description: 'Review detailed feedback and improve your interview skills.',
      gradient: 'linear-gradient(135deg, #10b981 0%, #14b8a6 100%)'
    }
  ];

  const testimonials = [
    {
      name: 'Sarah Ahmed',
      role: 'Software Engineer',
      quote: 'This platform helped me prepare for my dream job! The AI feedback was incredibly insightful and helped me improve my answers.',
      rating: 5
    },
    {
      name: 'Mohammed Hassan',
      role: 'Business Analyst',
      quote: 'I was nervous about interviews, but practicing here boosted my confidence tremendously. Highly recommend!',
      rating: 5
    },
    {
      name: 'Fatima Ali',
      role: 'Marketing Specialist',
      quote: 'The real-time feedback feature is amazing! It\'s like having a personal interview coach available 24/7.',
      rating: 5
    }
  ];

  return (
    <div>
      <Navbar variant="landing" showAuth={true} />
      
      {/* Hero Section */}
<section
  className="hero-section bg-gradient-page"
  style={{
    paddingTop: '4rem',
    paddingBottom: '1rem',
    overflow: 'hidden',
    width: '100%'
  }}
>
  <div className="container-fluid px-0">

    <div className="row justify-content-center mx-0">

      <div className="col-12 text-center px-0">

        <h1 className="display-3 fw-bold mb-4">
          Master Your{' '}
          <span className="text-gradient">
            Interview Skills
          </span>{' '}
          with AI
        </h1>

        <p
          className="lead text-muted mb-4"
          style={{
            fontSize: '1.25rem',
            maxWidth: '900px',
            margin: '0 auto'
          }}
        >
          Practice interviews with AI-powered simulations,
          get instant feedback, and land your dream job
          with confidence.
        </p>

        <div className="d-flex gap-3 justify-content-center flex-wrap mb-5">
          <GradientButton
            variant="primary"
            size="lg"
            onClick={() => navigate('/register')}
          >
            Start Free Interview{' '}
            <i className="bi bi-arrow-right ms-2"></i>
          </GradientButton>

          <GradientButton
            variant="outline"
            size="lg"
            onClick={() => navigate('/login')}
          >
            <i className="bi bi-play-circle me-2"></i>
            View Demo
          </GradientButton>
        </div>

        {/* Live AI Interview Preview */}
        <div className="w-100 px-0">
          <LiveInterviewPreview />
        </div>

      </div>

    </div>

  </div>
</section>

      {/* Live Interview Preview Hero Demo
      <LiveInterviewPreview /> */}

      {/* Features Section */}
      <section className="py-4 bg-body">
        <div className="container">
          <div className="text-center mb-5">
            <h2 className="display-5 fw-bold mb-3">Why Choose Our Platform?</h2>
            <p className="lead text-muted">Everything you need to ace your next interview</p>
          </div>
          <div className="row g-4">
            {features.map((feature, index) => (
              <div key={index} className="col-12 col-md-6 col-lg-3">
                <FeatureCard {...feature} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section className="py-5 bg-gradient-soft">
        <div className="container">
          <div className="text-center mb-5">
            <h2 className="display-5 fw-bold mb-3">How It Works</h2>
            <p className="lead text-muted">Get started in 4 simple steps</p>
          </div>
          <div className="row g-4">
            {steps.map((step, index) => (
              <div key={index} className="col-12 col-md-6 col-lg-3">
                <div className="step-card">
                  <div 
                    className="mx-auto mb-4 d-flex align-items-center justify-content-center fw-bold text-white"
                    style={{
                      width: '80px',
                      height: '80px',
                      borderRadius: '50%',
                      background: step.gradient,
                      fontSize: '2rem'
                    }}
                  >
                    {step.number}
                  </div>
                  <h5 className="fw-bold mb-3">{step.title}</h5>
                  <p className="text-muted">{step.description}</p>
                </div>
                {index < steps.length - 1 && (
                  <div className="d-none d-lg-block timeline-connector"></div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-5 bg-body">
        <div className="container">
          <div className="text-center mb-5">
            <h2 className="display-5 fw-bold mb-3">What Our Users Say</h2>
            <p className="lead text-muted">Join thousands of successful candidates</p>
          </div>
          <div className="row g-4">
            {testimonials.map((testimonial, index) => (
              <div key={index} className="col-12 col-md-6 col-lg-4">
                <TestimonialCard {...testimonial} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-5">
        <div className="container">
          <div className="card border-0 bg-gradient-primary text-white shadow-lg">
            <div className="card-body text-center py-5">
              <h2 className="display-5 fw-bold mb-3">Ready to Ace Your Interview?</h2>
              <p className="lead mb-4">
                Start practicing today and boost your confidence for the big day.
              </p>
              <GradientButton 
                variant="white" 
                size="lg"
                onClick={() => navigate('/register')}
                className="text-primary fw-bold"
              >
                Get Started Free <i className="bi bi-arrow-right ms-2"></i>
              </GradientButton>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-5 bg-dark text-white">
        <div className="container">
          <div className="row g-4">
            <div className="col-12 col-md-6 col-lg-3">
              <div className="d-flex align-items-center mb-3">
                <div className="icon-circle bg-gradient-secondary me-2">
                  <i className="bi bi-brain text-white"></i>
                </div>
                <span className="fw-bold fs-5">AI Interview</span>
              </div>
              <p className="text-muted">
                Practice and master your interview skills with AI-powered simulations.
              </p>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <h6 className="fw-bold mb-3">Product</h6>
              <a href="#" className="footer-link">Features</a>
              <a href="#" className="footer-link">Pricing</a>
              <a href="#" className="footer-link">FAQ</a>
              <a href="#" className="footer-link">Support</a>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <h6 className="fw-bold mb-3">Company</h6>
              <a href="#" className="footer-link">About Us</a>
              <a href="#" className="footer-link">Careers</a>
              <a href="#" className="footer-link">Blog</a>
              <a href="#" className="footer-link">Contact</a>
            </div>
            <div className="col-12 col-md-6 col-lg-3">
              <h6 className="fw-bold mb-3">Legal</h6>
              <a href="#" className="footer-link">Privacy Policy</a>
              <a href="#" className="footer-link">Terms of Service</a>
              <a href="#" className="footer-link">Cookie Policy</a>
            </div>
          </div>
          <hr className="my-4 border-secondary" />
          <div className="text-center text-muted">
            <p className="mb-0">&copy; 2026 AI Interview Simulator. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
