import React, { useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import Landing from './Landing';

const App = () => {
  const [activePopup, setActivePopup] = useState(null);

  const togglePopup = (id) => {
    setActivePopup(activePopup === id ? null : id);
  };

  return (
    <div id="page-container" style={{ fontFamily: 'Open Sans, Arial, sans-serif', color: '#666', backgroundColor: '#fff' }}>
      <div id="et-boc" className="et-boc">
        <Header />
        <Routes>
          <Route path="/" element={<MainContent />} />
          <Route path="/algo-services" element={<Landing />} />
        </Routes>
        <Footer togglePopup={togglePopup} activePopup={activePopup} />
      </div>
    </div>
  );
};

// Header Component
const Header = () => {
  return (
    <header className="et-l et-l--header" style={{ backgroundColor: '#f8f8f8', padding: '20px 0' }}>
      <div className="et_builder_inner_content" style={{ width: '80%', maxWidth: '1080px', margin: 'auto' }}>
        <div className="et_pb_section et_pb_with_background">
          <div className="et_pb_row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="et_pb_column et_pb_column_1_3">
              <div className="et_pb_module et_pb_image">
                <span className="et_pb_image_wrap">
                  <img
                    src="https://adptai.in/wp-content/uploads/2025/01/adptai-logo.png"
                    alt="Adptai Logo"
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                </span>
              </div>
            </div>
            <div className="et_pb_column et_pb_column_2_3" style={{ textAlign: 'right' }}>
              <div className="et_pb_module et_pb_text">
                <div className="et_pb_text_inner">
                  <p><a href="mailto:info@adptai.in" style={{ color: '#2ea3f2' }}>info@adptai.in</a></p>
                  <p><a href="tel:+919876543210" style={{ color: '#2ea3f2' }}>+91 987 654 3210</a></p>
                </div>
              </div>
              <div className="et_pb_button_module_wrapper">
                <a
                  className="et_pb_button"
                  href="tel:+919876543210"
                  style={{
                    fontSize: '20px',
                    padding: '0.3em 1em',
                    border: '2px solid #2ea3f2',
                    borderRadius: '3px',
                    color: '#2ea3f2',
                    textDecoration: 'none',
                  }}
                >
                  +91 987 654 3210
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

// Main Content Component (Home Page)
const MainContent = () => {
  return (
    <div id="main-content" style={{ padding: '40px 0', backgroundColor: '#fff' }}>
      <article>
        <div className="entry-content">
          <div className="et_pb_section">
            <div className="et_pb_row" style={{ width: '80%', maxWidth: '1080px', margin: 'auto' }}>
              <div className="et_pb_column et_pb_column_4_4">
                <div className="et_pb_module et_pb_blurb" style={{ textAlign: 'center' }}>
                  <div className="et_pb_blurb_content">
                    <h1 style={{ fontSize: '60px', color: '#000', marginBottom: '10px' }}>Welcome to Adptai</h1>
                    <div className="et_pb_blurb_description">
                      <p style={{ fontSize: '20px', lineHeight: '1.5em' }}>
                        Empowering businesses with cutting-edge AI solutions for a smarter future.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="et_pb_button_module_wrapper" style={{ textAlign: 'center', marginTop: '20px' }}>
                  <Link
                    to="/algo-services"
                    className="et_pb_button"
                    style={{
                      fontSize: '20px',
                      padding: '0.3em 1em',
                      border: '2px solid #2ea3f2',
                      borderRadius: '3px',
                      color: '#2ea3f2',
                      textDecoration: 'none',
                      display: 'inline-block',
                    }}
                  >
                    AI Services
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
};

// Footer Component
const Footer = ({ togglePopup, activePopup }) => {
  return (
    <footer className="et-l et-l--footer" style={{ backgroundColor: '#f8f8f8', padding: '40px 0' }}>
      <div className="et_builder_inner_content" style={{ width: '80%', maxWidth: '1080px', margin: 'auto' }}>
        <div className="et_pb_section et_pb_with_background">
          <div className="et_pb_row" style={{ display: 'flex', flexWrap: 'wrap' }}>
            <div className="et_pb_column et_pb_column_1_4" style={{ flex: '1', minWidth: '200px', marginBottom: '20px' }}>
              <div className="et_pb_module et_pb_image">
                <span className="et_pb_image_wrap">
                  <img
                    src="https://adptai.in/wp-content/uploads/2025/01/adptai-logo.png"
                    alt="Adptai Logo"
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                </span>
              </div>
              <ul className="et_pb_social_media_follow" style={{ listStyle: 'none', padding: 0, marginTop: '10px' }}>
                <li className="et_pb_social_network_link et-social-facebook" style={{ display: 'inline-block', marginRight: '10px' }}>
                  <a href="https://www.facebook.com/adptai" style={{ color: '#2ea3f2' }} target="_blank" rel="noopener noreferrer">
                    Facebook
                  </a>
                </li>
                <li className="et_pb_social_network_link et-social-instagram" style={{ display: 'inline-block' }}>
                  <a href="https://www.instagram.com/adptai" style={{ color: '#2ea3f2' }} target="_blank" rel="noopener noreferrer">
                    Instagram
                  </a>
                </li>
              </ul>
            </div>
            <div className="et_pb_column et_pb_column_1_4" style={{ flex: '1', minWidth: '200px', marginBottom: '20px' }}>
              <div className="et_pb_module et_pb_text">
                <h2 style={{ color: '#333', paddingBottom: '10px' }}>AI Services</h2>
                <div className="et_pb_divider" style={{ borderBottom: '1px solid #ccc', marginBottom: '10px' }}></div>
                <p><strong><a href="https://adptai.in/ai-automation/" style={{ color: '#2ea3f2' }}>AI Automation</a></strong></p>
                <p><strong><a href="https://adptai.in/machine-learning/" style={{ color: '#2ea3f2' }}>Machine Learning</a></strong></p>
                <p><strong><a href="https://adptai.in/data-analytics/" style={{ color: '#2ea3f2' }}>Data Analytics</a></strong></p>
              </div>
            </div>
            <div className="et_pb_column et_pb_column_1_4" style={{ flex: '1', minWidth: '200px', marginBottom: '20px' }}>
              <div className="et_pb_module et_pb_text">
                <h2 style={{ color: '#333', paddingBottom: '10px' }}>Tech Services</h2>
                <div className="et_pb_divider" style={{ borderBottom: '1px solid #ccc', marginBottom: '10px' }}></div>
                <p><a href="#web-development" onClick={() => togglePopup('web-development')} style={{ color: '#2ea3f2' }}><b>Web Development</b></a></p>
                <p><a href="#app-development" onClick={() => togglePopup('app-development')} style={{ color: '#2ea3f2' }}><b>Mobile App Development</b></a></p>
                <p><a href="#software-development" onClick={() => togglePopup('software-development')} style={{ color: '#2ea3f2' }}><b>Software Development</b></a></p>
              </div>
            </div>
            <div className="et_pb_column et_pb_column_1_4" style={{ flex: '1', minWidth: '200px', marginBottom: '20px' }}>
              <div className="et_pb_module et_pb_text">
                <h2 style={{ color: '#333', paddingBottom: '10px' }}>Contact Us</h2>
                <div className="et_pb_divider" style={{ borderBottom: '1px solid #ccc', marginBottom: '10px' }}></div>
                <p>📍 PLOT – 2020 SECTOR 5 GURGAON HR 122001</p>
                <p>📧 <a href="mailto:info@adptai.in" style={{ color: '#2ea3f2' }}>info@adptai.in</a></p>
                <p>📞 <a href="tel:+919876543210" style={{ color: '#2ea3f2' }}>+91 987 654 3210</a></p>
              </div>
            </div>
          </div>
          <div className="et_pb_row" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
            <div className="et_pb_column et_pb_column_1_2">
              <p>© 2025 <a href="https://adptai.in/" style={{ color: '#2ea3f2' }}>Adptai</a> All Rights Reserved</p>
            </div>
            <div className="et_pb_column et_pb_column_1_2" style={{ textAlign: 'right' }}>
              <p>
                <a href="https://adptai.in/privacy-policy/" style={{ color: '#2ea3f2' }}>Privacy Policy</a> |{' '}
                <a href="https://adptai.in/terms-conditions/" style={{ color: '#2ea3f2' }}>Terms & Conditions</a>
              </p>
            </div>
          </div>
        </div>

        {/* Popup Sections */}
        <Popup
          id="web-development"
          isActive={activePopup === 'web-development'}
          togglePopup={() => togglePopup('web-development')}
          title="Web Development"
          content="We have a dedicated team of experienced web developers, designers, and testers, proficient in creating innovative websites tailored to your needs."
          image="https://adptai.in/wp-content/uploads/2025/01/web-development.jpg"
        />
        <Popup
          id="app-development"
          isActive={activePopup === 'app-development'}
          togglePopup={() => togglePopup('app-development')}
          title="Mobile App Development"
          content="Our expert developers craft high-performance, user-friendly mobile apps for Android and iOS, designed to boost your business."
          image="https://adptai.in/wp-content/uploads/2025/01/app-development-1.png"
        />
        <Popup
          id="software-development"
          isActive={activePopup === 'software-development'}
          togglePopup={() => togglePopup('software-development')}
          title="Software Development"
          content="With over 18+ years of experience, we deliver customized software solutions for startups and enterprises worldwide."
          image="https://adptai.in/wp-content/uploads/2025/01/software-development.jpg"
        />
      </div>
    </footer>
  );
};

// Popup Component
const Popup = ({ id, isActive, togglePopup, title, content, image }) => {
  return (
    <div
      id={id}
      className="et_pb_section popup"
      style={{
        display: isActive ? 'block' : 'none',
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        backgroundColor: '#fff',
        padding: '20px',
        boxShadow: '0 0 10px rgba(0,0,0,0.3)',
        zIndex: 1000,
        width: '80%',
        maxWidth: '600px',
      }}
    >
      <div className="et_pb_row" style={{ display: 'flex', alignItems: 'center' }}>
        <div className="et_pb_column et_pb_column_1_2">
          <div className="et_pb_module et_pb_text">
            <h2>{title}</h2>
            <p>{content}</p>
            <button onClick={togglePopup} style={{ padding: '5px 10px', cursor: 'pointer' }}>Close</button>
          </div>
        </div>
        <div className="et_pb_column et_pb_column_1_2">
          <div className="et_pb_module et_pb_image">
            <img src={image} alt={title} style={{ maxWidth: '100%', height: 'auto' }} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;