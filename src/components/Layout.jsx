import React from "react";
import { Outlet } from "react-router-dom";
import { Container, Button, Dropdown, ButtonGroup } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faUserCog, 
  faSignInAlt, 
  faUsers, 
  faUserPlus 
} from '@fortawesome/free-solid-svg-icons';

const Layout = () => {
  return (
    <Container fluid className="p-0 wow-container">
      <header className="header wow-header">
        <div className="header-content">
          <span className="header-title">ADPTAI Multi Broker Trading Platform</span>
          <div className="header-actions">
            <Button variant="primary" className="header-btn" onClick={() => alert("Admin Panel coming soon!")}>
              <FontAwesomeIcon icon={faUserCog} /> Admin
            </Button>
            <Button variant="primary" className="header-btn ms-2" onClick={() => alert("Logging out...")}>
              Logout
            </Button>
            <Dropdown as={ButtonGroup} className="user-dropdown">
              <Dropdown.Toggle variant="primary" id="dropdown-basic">
                <FontAwesomeIcon icon={faUserCog} />
              </Dropdown.Toggle>
              <Dropdown.Menu>
                <Dropdown.Item onClick={() => alert("Register coming soon!")}>
                  <FontAwesomeIcon icon={faUserPlus} className="me-2" /> Register
                </Dropdown.Item>
                <Dropdown.Item onClick={() => alert("View Users coming soon!")}>
                  <FontAwesomeIcon icon={faUsers} className="me-2" /> View Users
                </Dropdown.Item>
                <Dropdown.Item onClick={() => window.open('https://www.shoonya.com/login', '_blank')}>
                  <FontAwesomeIcon icon={faSignInAlt} className="me-2" /> Shoonya Login
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
          </div>
        </div>
      </header>
      <Outlet />
    </Container>
  );
};

export default Layout;